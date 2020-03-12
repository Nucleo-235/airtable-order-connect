require('dotenv').config();

var moment = require('moment');
var asana = require('asana');
var fs = require('fs');
var asanaClient = asana.Client.create().useAccessToken(process.env.ASANA_TOKEN);

const nucleoWorkspaceId = 394848771496054;
const lucasUser = { id: 726605816678604, gid: '726605816678604', name: 'Lucas Cordeiro', resource_type: 'user' };
const henriqueUser = { id: 87698187785943, gid: '87698187785943', name: 'Henrique Rangel', resource_type: 'user' };
const users = {
  'henrique': henriqueUser,
  'lucas': lucasUser,
};


const limitRequests = 100;
let requestCount = 0;
const projectMap = { };
const parentTaskMaps = { };
function getTask(itemId) {
  if (parentTaskMaps[`t${itemId}`]) {
    return Promise.resolve(parentTaskMaps[`t${itemId}`]);
  }
  requestCount = requestCount + 1;
  if (requestCount > 0 && requestCount % limitRequests === 0) {
    // console.log('getTask1', itemId);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        return asanaClient.tasks.findById(itemId).then(task => {
          parentTaskMaps[`t${itemId}`] = task;
          resolve(task);
        }, reject);
      }, 60 * 1000);
    });
  } else {
    // console.log('getTask2', itemId);
    return asanaClient.tasks.findById(itemId).then(task => {
      parentTaskMaps[`t${itemId}`] = task;
      return task;
    });
  }
}

function getProject(itemId) {
  if (projectMap[`p${itemId}`]) {
    return Promise.resolve(projectMap[`p${itemId}`]);
  }
  requestCount = requestCount + 1;
  if (requestCount > 0 && requestCount % limitRequests === 0) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        return asanaClient.projects.findById(itemId).then(project => {
          projectMap[`p${itemId}`] = project;
          resolve(project);
        }, reject);
      }, 60 * 1000);
    });
  } else {
    // console.log('getTask2', itemId);
    return asanaClient.projects.findById(itemId).then(project => {
      projectMap[`p${itemId}`] = project;
      return project;
    });
  }
}

function getTaskProjects(item) {
  if (item.parent) {
    return getTask(item.parent.gid).then(parent => getTaskProjects(parent));
  } else if (item.projects && item.projects.length > 0) {
    return Promise.all(item.projects.map(p => getProject(p.gid)))
  } else {
    return Promise.resolve([]);
  }
}

function processNextPage(response, baseArray) {
  if (!response.nextPage) {
    return Promise.resolve(baseArray);
  }
  return new Promise((resolve, reject) => {
    requestCount = requestCount + 1;
    if (requestCount > 0 && requestCount % limitRequests === 0) {
      console.log('nextPage1');
      setTimeout(() => {
        response.nextPage().then(function(nextPageResponse) {
          var newResult = nextPageResponse ? nextPageResponse.data || nextPageResponse : [];
          if (Array.isArray(newResult) && newResult.length > 0) {
            baseArray.push.apply(baseArray, newResult);
            processNextPage(nextPageResponse, baseArray).then(resolve, reject);
          } else {
            resolve(baseArray);
          }
        }, reject);
      }, 60 * 1000);
    } else {
      console.log('nextPage2');
      response.nextPage().then(function(nextPageResponse) {
        var newResult = nextPageResponse ? nextPageResponse.data || nextPageResponse : [];
        if (Array.isArray(newResult) && newResult.length > 0) {
          baseArray.push.apply(baseArray, newResult);
          processNextPage(nextPageResponse, baseArray).then(resolve, reject);
        } else {
          resolve(baseArray);
        }
      }, reject);
    }
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

function getTasks(options) {
  return processAsanaListRequest(asanaClient.tasks.findAll(options));
}

function getCompletedUsersTasks(userId, userName, date, dateEnd) {
  return getTasks({
    assignee: userId,
    workspace: nucleoWorkspaceId,
    completed_since: moment(date).subtract(1, 'week').format(),
    opt_fields: 'id, name, due_on, notes, description, completed, projects, parent',
    limit: 100,
  }).then(tasks => {
    const promises = tasks.map(task => exec => {
      return getTaskProjects(task).then(projects => {
        for (let pIndex = 0; pIndex < projects.length; pIndex++) {
          const project = projects[pIndex];
          task[`project${pIndex+1}`] = project;
          task[`projectName${pIndex+1}`] = project.name;
        }
        task.userName = userName;
        return task;
      });
    });
    return promiseSerial(promises);
  }).then(tasks => {
    const dateMoment = moment(date);
    const dateEndMoment = moment(dateEnd);
    const finalTasks = tasks
      .filter(t => t.completed)
      .filter(t => { 
        const dueOnMoment = moment(t.due_on);
        return dueOnMoment.isSameOrAfter(dateMoment) && dueOnMoment.isBefore(dateEndMoment);
      });
    return processTasks(finalTasks, date, dateEnd);
  })
}

const hourRegex = { divider: 1.0, regex: /\[([0-9]*\.?[0-9]*)h\]/gm }
const minutes1Regex = { divider: 60.0, regex: /\[([0-9]*\.?[0-9]*)min\]/gm }
const minutes2Regex = { divider: 60.0, regex: /\[([0-9]*\.?[0-9]*)m\]/gm }
const regexes = [ hourRegex, minutes1Regex, minutes2Regex ];

function getWorkPeriod(task, day) {
  const notes = task.notes;
  if (notes) {
    for (const regexObj of regexes) {
      let res = regexObj.regex.exec(notes);
      if (res && res.length > 1) {
        // console.log(`res1 ${task.gid}: ${res[1]} = ${Number(res[1]) / regexObj.divider}`);
        return Number(res[1]) / regexObj.divider;
      } else {
        res = regexObj.regex.exec(unescape(notes));
        if (res && res.length > 1) {
          // console.log(`res2 ${task.gid}: ${res[1]} = ${Number(res[1]) / regexObj.divider}`);
          return Number(res[1]) / regexObj.divider;
        }
      }
    }
  }
  return null;
}

function processTasks(tasks, date, dateEnd) {
  const days = {};
  for (const task of tasks) {
    const dueOnMoment = moment(task.due_on);
    const dayKey = dueOnMoment.format("YYYYMMDD");
    if (!days[dayKey]) {
      const totalHours = dueOnMoment.day() < 5 ? 10 : 4;
      days[dayKey] = { hours: totalHours, tasks: [] };
    }
    const day = days[dayKey];
    day.tasks.push(task);
    
    task.workHours = getWorkPeriod(task, day);
    if (task.workHours != null) {
      day.hours = day.hours - task.workHours;
    } else {
      day.noWorkTasks = (day.noWorkTasks ? day.noWorkTasks : 0) + 1;
    }
  }
  const noWorkHoursTasks = tasks.filter(t => t.workHours === null);
  for (const task of noWorkHoursTasks) {
    // const dueOnMoment = moment(task.due_on);
    const dayKey = moment(task.due_on).format("YYYYMMDD");
    const day = days[dayKey];
    if (day.hours > 0) {
      task.workHours = day.hours / day.noWorkTasks;
      // console.log(`res3 ${task.gid}: = ${task.workHours}`);
    } else {
      task.workHours = 1;
    }
  }
  return tasks;
}

const promiseSerial = funcs =>
  funcs.reduce((promise, func) =>
    promise.then(result => func().then(Array.prototype.concat.bind(result))),
    Promise.resolve([]))

function getAllUsersTasks(date, dateEnd) {
  return promiseSerial([
    exec => getCompletedUsersTasks(lucasUser.gid, 'lucas', date, dateEnd),
    exec => getCompletedUsersTasks(henriqueUser.gid, 'henrique', date, dateEnd),
  ]);
};

function getAllUsersTasks(date, dateEnd) {
  return promiseSerial([
    exec => getCompletedUsersTasks(lucasUser.gid, 'lucas', date, dateEnd),
    exec => getCompletedUsersTasks(henriqueUser.gid, 'henrique', date, dateEnd),
  ]);
};

function getUserSummary(username, date, dateEnd) {
  const user = users[username];
  return getCompletedUsersTasks(user.gid, username, date, dateEnd).then(tasks => {
    const summary = { 
      count: tasks.length,
      hours: tasks.reduce( (a, b)=> a + (b.workHours || 0), 0),
      // tasks: tasks,
    }
    // console.log('COUNT', summary.count);
    // console.log('HOURS', summary.hours);
    // console.log('TASKS', tasks);
    return summary;
  })
};

function getTodayUserSummary(username) {
  return getUserSummary(username, 
    moment().startOf('day').format('YYYY-MM-DD'), 
    moment().startOf('day').add(1,'days').format('YYYY-MM-DD'));
}
function getLastWeekUserSummary(username) {
  return getUserSummary(username, 
    moment().startOf('week').add(-1,'weeks').format('YYYY-MM-DD'), 
    moment().startOf('week').format('YYYY-MM-DD'));
}
function getCurrentWeekUserSummary(username) {
  return getUserSummary(username, 
    moment().startOf('week').format('YYYY-MM-DD'), 
    moment().startOf('week').add(1, 'weeks').format('YYYY-MM-DD'));
}
async function getFullUserSummary(username) {
  const today = await getTodayUserSummary(username);
  const lastWeek = await getLastWeekUserSummary(username);
  const currentWeek = await getCurrentWeekUserSummary(username);
  const result = {
    today,
    lastWeek,
    currentWeek,
  };
  console.log('FullUserSummary', result);
  return result;
}

const { createReadStream, createWriteStream } = require('fs');
const { AsyncParser } = require('json2csv');
const fields = "gid,due_on,name,userName,workHours,projectName1,projectName2,projectName3,projectName4".split(",");
const opts = { fields };
const transformOpts = { highWaterMark: 8192 };

function writeUsersCSVs(date, dateEnd) {
  return new Promise((resolve, reject) => {
    getAllUsersTasks(date, dateEnd).then(userResults => {
      const result = [];
      for (let i = 0; i < userResults.length; i++) {
        const userData = userResults[i];
        // console.log(userData);
        const copied = Object.assign({}, userData);
        copied.workHours = copied.workHours.toString().replace(".",",");
        result.push(copied);
      }
      
      console.log('writing');
      const inputPath = 'report.json';
      const outputPath = 'report.csv';
      fs.writeFile(inputPath, JSON.stringify(result), 'utf8', function(error) {
        if (error) {
          reject(error);
        } else {
          const input = createReadStream(inputPath, { encoding: 'utf8' });
          const output = createWriteStream(outputPath, { encoding: 'utf8' });
          const asyncParser = new AsyncParser(opts, transformOpts);
          asyncParser.fromInput(input).toOutput(output).promise()
            .then(csv => {
              console.log("csv written");
              resolve(csv);
            }, error => {
              console.log("csv error", error);
              reject(error);
            });
        }
      });
    }, reject);
  });
}
module.exports = {
  getCompletedUsersTasks,
  getAllUsersTasks,
  writeUsersCSVs,
  getUserSummary,
  getTodayUserSummary,
  getLastWeekUserSummary,
  getCurrentWeekUserSummary,
  getFullUserSummary
}

// var asanaReporter = require('./asana-reporter')
// asanaReporter.getAllUsersTasks('2019-04-01', '2019-05-01')
// asanaReporter.writeUsersCSVs('2019-04-01', '2019-05-01')
// asanaReporter.getTodayUserSummary('henrique')