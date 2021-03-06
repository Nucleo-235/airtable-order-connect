require('dotenv').config()
var AirtableBase = require('./airtable_base.js');
var extend = require('extend');

var asana = require('asana');
var asanaClient = asana.Client.create().useAccessToken(process.env.ASANA_TOKEN);

function replaceLines(value) {
  return value.replace(/(?:\r\n|\r|\n)/g, '<br>');
}

function processNextPage(response, baseArray) {
  if (!response.nextPage) {
    return Promise.resolve(baseArray);
  }
  return new Promise((resolve, reject) => {
    response.nextPage().then(function(nextPageResponse) {
      var newResult = nextPageResponse ? nextPageResponse.data || nextPageResponse : [];
      if (Array.isArray(newResult) && newResult.length > 0) {
        baseArray.push.apply(baseArray, newResult);
        processNextPage(nextPageResponse, baseArray).then(resolve, reject);
      } else {
        resolve(baseArray);
      }
    }, reject);
  });
}

function processAsanaRequest(asanaRequest) {
  return new Promise((resolve, reject) => {
    return asanaRequest.then(response => {
      // console.log(response);
      return resolve(response.data || response);
    }, reject);
  });
}

function processAsanaListRequest(asanaRequest) {
  return new Promise((resolve, reject) => {
    return asanaRequest.then(response => {
      var baseResult = response.data || response;
      if (Array.isArray(baseResult)) {
        processNextPage(response, baseResult).then(resolve, reject);
      } else {
        resolve(baseResult);
      }
    }, reject);
  });
}

function findOne(asanaListPromise, listName, filterCallback) {
  return new Promise((resolve, reject) => {
    return AirtableBase.findFiltered(asanaListPromise, filterCallback).then(results => {
      if (results.length > 0) {
        asanaClient[listName].findById(results[0].gid).then(resolve, reject);
      } else {
        resolve(null);
      }
    }, reject);
  });
}

function getWorkspaces() {
  return processAsanaListRequest(asanaClient.workspaces.findAll({ limit: 100 }));
}
function getWorkspaceInfoByName(name) {
  return findOne(getWorkspaces(), "workspaces", item => item.name === name);
}
function getProjects(workspace) {
  const request = asanaClient.projects.findByWorkspace(workspace.gid, { limit: 100 });
  return processAsanaListRequest(request);
}
function getProjectByName(workspace, name) {
  return findOne(getProjects(workspace), "projects", item => item.name === name);
}
function getTasks(project) {
  const request = asanaClient.tasks.findByProject(project.gid, { limit: 100, opt_fields: "name,completed,memberships.section.gid,memberships.section.name,memberships.project.gid,memberships.project.name" });
  return processAsanaListRequest(request);
}
function getSectionTasks(project, section) {
  const sectionId = section.gid;
  return AirtableBase.findFiltered(getTasks(project), item => item.memberships && item.memberships.filter(member => member.section && member.section.gid === sectionId).length > 0);
}
function getIncompleteSectionTasks(project, section) {
  const sectionId = section.gid;
  return AirtableBase.findFiltered(getTasks(project), item => !item.completed && item.memberships && item.memberships.filter(member => member.section && member.section.gid === sectionId).length > 0);
}
function getSubTasks(task) {
  const request = asanaClient.tasks.subtasks(task.gid, { limit: 100, opt_fields: "name,completed,memberships.section.gid, memberships.section.name, memberships.project.gid, memberships.project.name" });
  return AirtableBase.findFiltered(processAsanaListRequest(request), item => !item.completed);
}
function findTaskByName(project, name) {
  return findOne(getTasks(project), "tasks", item => item.name === name);
}

function getSections(project) {
  const request = asanaClient.sections.findByProject(project.gid, { limit: 100 });
  return processAsanaListRequest(request);
  
}
function getSectionByName(project, name) {
  var nameFormatted = name + ":";
  return findOne(getSections(project), "sections", item => item.name === name || item.name === nameFormatted);
}

function getSectionAndProject(workspace, projectName, sectionName) {
  return new Promise((resolve, reject) => {
    getProjectByName(workspace, projectName).then(project => {
      if (project) {
        getSectionByName(project, sectionName).then(section => {
          if (section) {
            resolve({section, project});
          } else {
            resolve(null);
          }
        }, reject);
      } else {
        resolve(null)
      }
    }, reject);
  })
}

function addToProject(task, project, section, last_task = null) {
  return new Promise((resolve, reject) => {
    const params = {
      project: project.gid,
      insert_before:  null
    };
    const newMembership = {
      project: project
    }

    // Checks if already is added to project
    if (task.memberships && task.memberships.filter(member => member.project && member.project.gid == project.gid).length > 0) {
      return Promise.resolve(task);
    }

    if (section) {
      // Checks if already is added to section
      if (task.memberships && task.memberships.filter(member => member.section && member.section.gid == section.gid).length > 0) {
        return Promise.resolve(task);
      } else {
        params.section = section.gid;
        delete params.insert_before;
        newMembership.section = section;
      }
    }

    if (last_task) {
      delete params.insert_before;
      delete params.section;
      params.insert_after = last_task.gid;
    }

    asanaClient.tasks.addProject(task.gid, params).then(() => {
      if (!task.memberships) {
        task.memberships = [];
      } 
      task.memberships.push(newMembership);
      console.log('addToProject ADDED', task.name || task.gid);
      resolve(task);
    }, error => {
      reject(error);
    })
  });
}

function doRemoveFromProject(task, project) {
  return new Promise((resolve, reject) => {
    const params = {
      project: project.gid
    };

    // Checks if is not added added to project
    if (!task.memberships || task.memberships.filter(member => member.project && member.project.gid == project.gid).length === 0) {
      return Promise.resolve(task);
    }

    asanaClient.tasks.removeProject(task.gid, params).then(() => {
      if (task.memberships) {
        const results = task.memberships.filter(member => member.project && member.project.gid == project.gid);
        for (const member of results) {
          const memberIndex = task.memberships.indexOf(member);
          if (memberIndex > 0) {
            task.memberships.splice(memberIndex, 1);
          }
        }
      }
      console.log('doRemoveFromProject', task.name || task.gid);
      resolve(task);
    }, reject)
  });
}

function saveTask(workspace, project, section, name, description, childrenDetails, parent = null) {
  return new Promise((resolve, reject) => {
    const data = {
      name: name,
      notes: description ? replaceLines(description) : description  ,
      workspace: workspace.gid,
    }
    if (parent) {
      data.parent = parent.gid;
    } else if (section) {
      data.projects = [ project.gid ];
      data.memberships = [ { project: project.gid, section: section.gid } ];
    }
    // console.log('saving', data);
    asanaClient.tasks.create(data).then(taskResult => {
      if (childrenDetails && childrenDetails.length > 0) {
        const funcs = [];
        // forçado reverse para garantir que insere na ordem correta
        const inverseChildrenDetails = childrenDetails.reverse();
        for (const childrenDetail of inverseChildrenDetails) {
          funcs.push(exec => saveTask(workspace, project, section, childrenDetail.name, childrenDetail.description, [], taskResult));
        }
        promiseSerial(funcs).then(results => {
          taskResult.subtasks = results;
          resolve(taskResult);
        }, reject);
      } else {
        resolve(taskResult);
      }
    }, reject);
  });
}

function saveTaskWithNames(workspaceName, projectName, sectionName, name, description, childrenDetails) {
  return new Promise((resolve, reject) => {
    getWorkspaceInfoByName(workspaceName).then(workspace => {
      if (workspace) {
        getProjectByName(workspace, projectName).then(project => {
          if (project) {
            if (sectionName) {
              getSectionByName(project, sectionName).then(section => {
                saveTask(workspace, project, section, name, description, childrenDetails).then(resolve, reject)
              }, reject)
            } else
              saveTask(workspace, project, null, name, description, childrenDetails).then(resolve, reject);
          } else
            resolve(null);
        }, reject)
      } else
        resolve(null);
    }, reject)
  });
}

function saveTasksWithNames(workspaceName, projectName, tasks, sectionName = null) {
  return new Promise((resolve, reject) => {
    getWorkspaceInfoByName(workspaceName).then(workspace => {
      if (workspace) {
        getProjectByName(workspace, projectName).then(project => {
          if (project) {
            if (sectionName) {
              getSectionByName(project, sectionName).then(section => {
                const funcs = [];
                for (const taskInfo of tasks) {
                  funcs.push(exec => saveTaskWithNames(workspaceName, projectName, sectionName, taskInfo.name, taskInfo.description || '', taskInfo.children));
                }
                promiseSerial(funcs).then(resolve, reject);
              }, reject)
            } else
              saveTask(workspace, project, null, name, '', childrenNames).then(resolve, reject);
          } else
            resolve(null);
        }, reject)
      } else
        resolve(null);
    }, reject)
  });
}

const promiseSerial = funcs =>
  funcs.reduce((promise, func) =>
    promise.then(result => func().then(Array.prototype.concat.bind(result))),
    Promise.resolve([]))

function saveAirtableToAsana(projetoCodigo, workspaceName, projectName, sectionName = null, projectFilter = null) {
  return AirtableBase.loadFullProjeto(projetoCodigo, projectFilter).then(projeto => {
    const newTasks = projeto.LoadedFuncionalidades.map(funcionalidade => {
      const newTask = { name: `${funcionalidade.Titulo} [${funcionalidade["Soma Diff"]}]`, children: [] };
      if (funcionalidade.Ator && funcionalidade.Ator.length) {
        newTask.name = `[${funcionalidade.Ator}] ` + newTask.name;
      }
      for (const item of funcionalidade.LoadedItems) {
        let itemName = `${item.Titulo} [${item["Resultado Qty"]}]`;
        let itemDesc = item["Descrição"] || '';
        if (item["Módulo"] && item["Módulo"].length) {
          itemName = `[${item["Módulo"]}] ` + itemName;
        }
        newTask.children.push({ name: itemName, description: itemDesc });
      }
      return newTask;
    })
    return saveTasksWithNames(workspaceName, projectName, newTasks, sectionName).then(results => {
      console.log('saveAirtableToAsana FINISHED');
      return results;
    });
  }, error => {
    console.log("error saving", error);
  });

}

function addChildrenToSection(workspaceName, sourceProjectName, sourceSectionName, targetProjectName, targetSectionName) {
  return new Promise((resolve, reject) => {
    getWorkspaceInfoByName(workspaceName).then(workspace => {
      if (workspace) {
        const projectPromises = [];
        projectPromises.push(getSectionAndProject(workspace, sourceProjectName, sourceSectionName));
        projectPromises.push(getSectionAndProject(workspace, targetProjectName, targetSectionName));
        Promise.all(projectPromises).then(projectsWithSections => {
          if (projectsWithSections[0] && projectsWithSections[1]) {
            const sourceProjectWithSection = projectsWithSections[0];
            const targetProjectWithSection = projectsWithSections[1];
            getIncompleteSectionTasks(sourceProjectWithSection.project, sourceProjectWithSection.section).then(tasks => {
              console.log('tasks', tasks.length);
              promiseSerial(tasks.map(task => exec => getSubTasks(task))).then(subTasks => {
                console.log('subTasks', subTasks.length);
                let lastTask = null;
                promiseSerial(subTasks.map(subTask => 
                  exec => { 
                    const result = addToProject(subTask, targetProjectWithSection.project, targetProjectWithSection.section, lastTask);
                    lastTask = subTask;
                    return result;
                  })
                ).then(finalResults => {
                  console.log('addChildrenToSection FINISHED');
                  resolve(finalResults);
                }, reject)
              }, reject);
            }, reject)
          } else {
            resolve(null);
          }
        }, reject)
      } else
        resolve(null);
    }, reject)
  });
}

function removeTasksFromSection(workspaceName, sourceProjectName, sourceSectionName) {
  return new Promise((resolve, reject) => {
    getWorkspaceInfoByName(workspaceName).then(workspace => {
      if (workspace) {
        getSectionAndProject(workspace, sourceProjectName, sourceSectionName).then(sourceProjectWithSection => {
          if (sourceProjectWithSection) {
            getSectionTasks(sourceProjectWithSection.project, sourceProjectWithSection.section).then(tasks => {
              promiseSerial(tasks.map(task => exec => doRemoveFromProject(task, sourceProjectWithSection.project))).then(finalResults => {
                console.log('finalResults', finalResults);
                resolve(finalResults);
              }, reject);
            }, reject)
          } else {
            resolve(null);
          }
        }, reject)
      } else
        resolve(null);
    }, reject)
  });
}

module.exports = {
  getWorkspaceInfoByName, getProjectByName, saveTaskWithNames, saveTasksWithNames, saveAirtableToAsana,
  addChildrenToSection, removeTasksFromSection
}

// var AirtableBase = require('./airtable_base.js');
// var asana = require('./asana-projects')

// TODAS
// asana.saveAirtableToAsana("000279-B - KPMG Site/App Op Escopo Fechado", "Nucleo", "KPMG", "V4-V5");
// LIMITANDO
// asana.saveAirtableToAsana("000279-B - KPMG Site/App Op Escopo Fechado", "Nucleo", "KPMG", "V4-V5", (proj) => { return AirtableBase.filterFuncionalidades(proj, 100, 110); });
// asana.removeTasksFromSection("Nucleo", "KPMG Sprint", "DONE")
// asana.addChildrenToSection("Nucleo", "Alinha", "Sprint 1 (até 44 pontos)", "Alinha Sprint", "TODO")