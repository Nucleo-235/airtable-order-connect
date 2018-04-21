require('dotenv').config()
var Airtable = require('airtable');
var extend = require('extend');
var base2018_01to03 = new Airtable({apiKey: process.env.API_KEY}).base('appdfAwtINoSYGqqD');
var base2018_03to = new Airtable({apiKey: process.env.API_KEY}).base('appUY5izA64IFGRd1');
var main_base = base2018_03to;
var bases = [base2018_01to03, base2018_03to];

function runOnBases(tempBases, runCallback, retryEndCallback) {
  const currentBase = tempBases[0];
  tempBases.splice(0, 1);
  const isLast = tempBases.length == 0;

  runCallback(currentBase, (err) => {
      if (tempBases.length == 0) {
          retryEndCallback(err);
      } else {
          runOnBases(tempBases, runCallback, retryEndCallback)
      }
  }, isLast)
}

function find(table, itemId) {
  return new Promise((resolve, reject) => {
      const tempBases = bases.slice();
      runOnBases(tempBases, (currentBase, tryRetryCallback) => {
          currentBase(table).find(itemId, function(err, record) {
              if (err) { 
                  tryRetryCallback(err);
              } else if (record) {
                  resolve(record);
              } else {
                  tryRetryCallback("no record");
              }
          });
      }, (err) => {
          reject(err);
      });
  });
}

function select(table, filters) {
  return new Promise((resolve, reject) => {
      const tempBases = bases.slice();
      runOnBases(tempBases, (currentBase, tryRetryCallback, isLast) => {
          var allItems = [];
          currentBase(table).select(filters).eachPage(function page(records, fetchNextPage) {
              records.forEach(function(record) {
                  allItems.push(record);
              });
              fetchNextPage();
          }, function done(err) {
              if (err) { 
                  tryRetryCallback(err);
              }
              else if (allItems.length > 0 || isLast) {
                  resolve(allItems);
              } else {
                  tryRetryCallback("no records");
              }
          });
      }, (err) => {
          reject(err);
      });
  });
}

function loadAllFuncionalidades(projeto, callback) {
  return select('Funcionalidades', {
      filterByFormula: `(SEARCH('${projeto}', Projeto) > 0)`,
      sort: [{field: "Codigo", direction: "asc"}]
  }).then(data => {
      // console.log('loadAllFuncionalidades data');
      callback(data);
  }, error => {
      console.error('loadAllFuncionalidades err', err);
  });
}

function getProjectRef(projetoCodigo) {
  return new Promise((resolve, reject) => {
    return select('Projetos', {
        maxRecords: 1,
        filterByFormula: `(SEARCH('${projetoCodigo}', Codigo) > 0)`,
    }).then(data => {
        resolve(data && data.length > 0 ? data[0] : null);
    }, error => {
        reject(error);
    });
  });
}

module.exports = { 
  runOnBases, find, select, main_base,
  loadAllFuncionalidades, getProjectRef 
};