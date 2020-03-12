require('dotenv').config()
var Airtable = require('airtable');
var extend = require('extend');
// le as bases e usa a primeira como principal
var bases = process.env.AIRTABLE_BASES.split(",").map(baseCode => new Airtable({apiKey: process.env.AIRTABLE_KEY}).base(baseCode));
var main_base = bases[0];

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

function loadItem(itemId) {
    return new Promise((resolve, reject) => {
        find('Items', itemId).then(record => {
            var item = extend({}, record.fields);
            item.id = record.id;
            resolve(item);
        }, reject);
    });
}

function loadFuncionalidade(funcionalidadeRef) {
    return new Promise((resolve, reject) => {
        var funcionalidade = extend({}, funcionalidadeRef.fields);
        funcionalidade.id = funcionalidadeRef.id;
        funcionalidade.LoadedItems = [];
        
        const promises = [];
        // console.log('items', original.Items ? original.Items.length : null);
        if (funcionalidade.Items) {
            for (let index = 0; index < funcionalidade.Items.length; index++) {
                const itemId = funcionalidade.Items[index];
                promises.push(loadItem(itemId, funcionalidade));
            }
        }
        Promise.all(promises).then(results => {
            funcionalidade.LoadedItems = results.sort((a, b) => a.Order - b.Order);
            // console.log("Loaded Items", funcionalidade.LoadedItems.map(i => i.Codigo));
            resolve(funcionalidade);
        }, reject);
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
      console.error('loadAllFuncionalidades err', error);
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

function loadProjeto(projetoCodigo) {
    return new Promise((resolve, reject) => {
        getProjectRef(projetoCodigo).then(record => {
            var projeto = extend({}, record.fields);
            projeto.id = record.id;
            resolve(projeto);
        }, reject);
    });
}

function loadFullProjeto(projeto, projectFilter = null) {
    return new Promise((resolve, reject) => {
        loadAllFuncionalidades(projeto, funcionalidades => {
            console.log('loadAllFuncionalidades', funcionalidades ? funcionalidades.length : null);
            loadProjeto(projeto).then(projetoLoaded => {
                const promises = [];
                for (let i = 0; i < funcionalidades.length; i++) {
                    const funcionalidade = funcionalidades[i];
                    promises.push(loadFuncionalidade(funcionalidade));
                }
                Promise.all(promises).then(result => {
                    projetoLoaded.LoadedFuncionalidades = result;
                    if (projectFilter)
                        projetoLoaded = projectFilter(projetoLoaded);
                    setTotals(projetoLoaded);
                    setActorGroups(projetoLoaded);
                    resolve(projetoLoaded);
                }, reject);
            });
            
        });
    });
}

function setTotals(projeto) {
    let projetoHours = 0;
    var baseHourMultipler = projeto["Fator Final"];
    var funcionalidades = projeto.LoadedFuncionalidades;
    for (let f = 0; f < funcionalidades.length; f++) {
        const funcionalidade = funcionalidades[f];
        funcionalidade.realHours = funcionalidade["Soma Diff"]* baseHourMultipler;
        funcionalidade.currentHours = Math.ceil(funcionalidade.realHours * 100) / 100.0;
        funcionalidade.hours = funcionalidade.currentHours;
        
        projetoHours += funcionalidade.realHours;

        var funcionalidadeHours = 0;
        for (let i = 0; i < funcionalidade.LoadedItems.length; i++) {
            const item = funcionalidade.LoadedItems[i];
            item.realHours = item["Resultado Qty"]* baseHourMultipler;
            item.currentHours = Math.ceil(item.realHours * 100) / 100.0;
            item.hours = item.currentHours;
        }
    }
    projeto.hours = projetoHours;
}

function setActorGroups(projeto) {
    const groupsMap = {};
    const groups = [];
    for (let f = 0; f < projeto.LoadedFuncionalidades.length; f++) {
        const funcionalidade = projeto.LoadedFuncionalidades[f];
        var ator = 'GLOBAL';
        if (funcionalidade.Ator && funcionalidade.Ator.trim().length > 0) {
            ator = funcionalidade.Ator;
        }
        var atorObj = groupsMap[ator];
        if (!atorObj) {
            atorObj = { name: ator, funcionalidades: [] };
            groups.push(atorObj);
            groupsMap[ator] = atorObj;
        }
        atorObj.funcionalidades.push(funcionalidade);
    }
    projeto.actorGroups = groups;
    for (let g = 0; g < projeto.actorGroups.length; g++) {
        const group = projeto.actorGroups[g];
        let groupHours = 0;
        
        var funcionalidades = group.funcionalidades;
        for (let f = 0; f < funcionalidades.length; f++) {
            const funcionalidade = funcionalidades[f];
            groupHours += funcionalidade.realHours;
        }
        group.hours = groupHours;
    }
}

function filterFuncionalidades(projeto, minOrder, maxOrder) {
    var funcionalidades = [];
    var removedFuncionalidades = [];
    for (const funcionalidade of projeto.LoadedFuncionalidades) {
        if (funcionalidade.Order >= minOrder && funcionalidade.Order <= maxOrder)
            funcionalidades.push(funcionalidade);
        else 
            removedFuncionalidades.push(funcionalidade);
    }
    projeto.LoadedFuncionalidades = funcionalidades;
    projeto.RemovedFuncionalidades = removedFuncionalidades;
    return projeto;
}

function findFiltered(asanaListPromise, filterCallback) {
    return new Promise((resolve, reject) => {
      return asanaListPromise.then(items => {
        resolve(items.filter(filterCallback));
      }, reject);
    });
  }

module.exports = { 
  runOnBases, find, select, main_base,
  getProjectRef, loadFullProjeto, loadProjeto,
  loadFuncionalidade, loadAllFuncionalidades,
  setTotals, setActorGroups, filterFuncionalidades,
  findFiltered
};