require('dotenv').config()
var AirtableBase = require('./airtable_base.js');
var extend = require('extend');

var asana = require('asana');
var asanaClient = asana.Client.create().useAccessToken(process.env.ASANA_TOKEN);

function processAsanaRequest(asanaRequest) {
  return new Promise((resolve, reject) => {
    return asanaRequest.then(response => {
      // console.log(response);
      return resolve(response.data || response);
    }, reject);
  });
}

function findOne(asanaListPromise, listName, filterCallback) {
  return new Promise((resolve, reject) => {
    return asanaListPromise.then(items => {
      const results = items.filter(filterCallback);
      if (results.length > 0) {
        asanaClient[listName].findById(results[0].id).then(resolve, reject);
      } else {
        resolve(null);
      }
    }, reject);
  });
}

function getWorkspaces() {
  return processAsanaRequest(asanaClient.workspaces.findAll({ }));
}
function getWorkspaceInfoByName(name) {
  return findOne(getWorkspaces(), "workspaces", item => item.name === name);
}
function getProjects(workspace) {
  const request = asanaClient.projects.findByWorkspace(workspace.id);
  return processAsanaRequest(request);
  
}
function getProjectByName(workspace, name) {
  return findOne(getProjects(workspace), "projects", item => item.name === name);
}

function getSections(project) {
  const request = asanaClient.sections.findByProject(project.id);
  return processAsanaRequest(request);
  
}
function getSectionByName(project, name) {
  var nameFormatted = name + ":";
  return findOne(getSections(project), "sections", item => item.name === name || item.name === nameFormatted);
}

function saveTask(workspace, project, section, name, childrenNames, parent = null) {
  return new Promise((resolve, reject) => {
    const data = {
      name: name,
      workspace: workspace.id,
    }
    if (parent) {
      data.parent = parent.id;
    } else if (section) {
      data.projects = [ project.id ];
      data.memberships = [ { project: project.id, section: section.id } ];
    }
    asanaClient.tasks.create(data).then(taskResult => {
      if (childrenNames && childrenNames.length > 0) {
        const promises = [];
        for (const childrenName of childrenNames) {
          promises.push(saveTask(workspace, project, section, childrenName, [], taskResult));
        }
        Promise.all(promises).then(results => {
          taskResult.subtasks = results;
          resolve(taskResult);
        }, reject);
      } else {
        resolve(taskResult);
      }
    }, reject);
  });
}

function saveTaskWithNames(workspaceName, projectName, sectionName, name, childrenNames) {
  return new Promise((resolve, reject) => {
    getWorkspaceInfoByName(workspaceName).then(workspace => {
      if (workspace) {
        getProjectByName(workspace, projectName).then(project => {
          if (project) {
            if (sectionName) {
              getSectionByName(project, sectionName).then(section => {
                saveTask(workspace, project, section, name, childrenNames).then(resolve, reject)
              }, reject)
            } else
              saveTask(workspace, project, null, name, childrenNames).then(resolve, reject);
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
                  funcs.push(exec => saveTaskWithNames(workspaceName, projectName, sectionName, taskInfo.name, taskInfo.children));
                }
                promiseSerial(funcs).then(resolve, reject);
              }, reject)
            } else
              saveTask(workspace, project, null, name, childrenNames).then(resolve, reject);
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
      const newTask = { name: `${funcionalidade.Titulo} (${funcionalidade.currentHours})`, children: [] };
      if (funcionalidade.Ator && funcionalidade.Ator.length) {
        newTask.name = `[${funcionalidade.Ator}] ` + newTask.name;
      }
      for (const item of funcionalidade.LoadedItems) {
        newTask.children.push(`${item.Titulo} (${item.currentHours})`);
      }
      return newTask;
    })
    return saveTasksWithNames(workspaceName, projectName, newTasks, sectionName);
  }, error => {
    console.log("error saving", error);
  });
}

module.exports = {
  getWorkspaceInfoByName, getProjectByName, saveTaskWithNames, saveTasksWithNames, saveAirtableToAsana
}

// var AirtableBase = require('./airtable_base.js');
// var asana = require('./asana')

// TODAS
// asana.saveAirtableToAsana("000279-B - KPMG Site/App Op Escopo Fechado", "Nucleo", "KPMG", "V4-V5");
// LIMITANDO
// asana.saveAirtableToAsana("000279-B - KPMG Site/App Op Escopo Fechado", "Nucleo", "KPMG", "V4-V5", (proj) => { return AirtableBase.filterFuncionalidades(proj, 100, 110); });