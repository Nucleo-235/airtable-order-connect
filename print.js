var Airtable = require('airtable');
var extend = require('extend');
var base = new Airtable({apiKey: process.env.API_KEY}).base('appdfAwtINoSYGqqD');
var fs = require('fs');


function loadAllFuncionalidades(projeto, callback) {
    var allFuncionalidads = [];

    base('Funcionalidades').select({
        // Selecting the first 3 records in Grid view:
        // maxRecords: 100,
        // view: "Grid view",
        filterByFormula: `(SEARCH('${projeto}', Projeto) > 0)`,
        sort: [{field: "Codigo", direction: "asc"}]
    }).eachPage(function page(records, fetchNextPage) {
        // This function (`page`) will get called for each page of records.
        records.forEach(function(record) {
            allFuncionalidads.push(record);
        });

        // To fetch the next page of records, call `fetchNextPage`.
        // If there are more records, `page` will get called again.
        // If there are no more records, `done` will get called.
        fetchNextPage();

    }, function done(err) {
        if (err) { console.error(err); return; }
        else {
            callback(allFuncionalidads);
        }
    });
}

function getProjectRef(projetoCodigo) {
    return new Promise((resolve, reject) => {
        var result = null;
        base('Projetos').select({
            // Selecting the first 3 records in Grid view:
            maxRecords: 1,
            filterByFormula: `(SEARCH('${projetoCodigo}', Codigo) > 0)`,
        }).eachPage(function page(records, fetchNextPage) {
            records.forEach(function(record) {
                result = record;
            });
            fetchNextPage();
        
        }, function done(err) {
            if (err) { console.error(err); reject(err); return; }
            else { resolve(result); }
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

function doLoadItem(itemId) {
    return new Promise((resolve, reject) => {
        base('Items').find(itemId, function(err, record) {
            if (err) { 
                console.error(err);
                reject(err); 
                return; 
            } else {
                var item = extend({}, record.fields);
                item.id = record.id;
                resolve(item);
            }
        });
    });
}

function loadFuncionalidade(funcionalidadeRef) {
    return new Promise((resolve, reject) => {
        var funcionalidade = extend({}, funcionalidadeRef.fields);
        funcionalidade.id = funcionalidadeRef.id;
        funcionalidade.LoadedItems = [];
        
        const promises = [];
        // console.log('items', original.Items ? original.Items.length : null);
        for (let index = 0; index < funcionalidade.Items.length; index++) {
            const itemId = funcionalidade.Items[index];
            promises.push(doLoadItem(itemId, funcionalidade));
        }
        Promise.all(promises).then(results => {
            funcionalidade.LoadedItems = results;
            resolve(funcionalidade);
        }, reject);
    });
}

function loadFullProjeto(projeto) {
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
                    resolve(projetoLoaded);
                }, reject);
            });
            
        });
    });
}

function writeToPrints(content, filename) {
    return new Promise((resolve, reject) => {
        var dir = "./prints";
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }

        fs.writeFile(dir + "/" + filename, content, function(err) {
            if(err) {
                reject(err);
                return console.log(err);
            } else {
                resolve(dir + "/" + filename);
            }
        }); 
    });
}

function printAll(projetoCodigo, includeHours, includeTotals) {
    var callback;
    if (includeHours) {
        callback = (html, funcionalidadelHtml, funcionalidade, baseHourMultipler) => { 
            funcionalidadelHtml += "\t<ul>\r\n";
            let hours = 0;
            for (let i = 0; i < funcionalidade.LoadedItems.length; i++) {
                const item = funcionalidade.LoadedItems[i];
                const realHours = item["Resultado Qty"]* baseHourMultipler;
                const currentHours = Math.ceil(realHours * 100) / 100.0;
                funcionalidadelHtml += `\t\t<li>${item.Titulo} (${currentHours})</li>\r\n`;
                hours += realHours;
            }
            if (includeTotals) {
                const finalHours = Math.ceil(hours * 100) / 100.0;
                funcionalidadelHtml += `\t\t<li class="sum"><strong>Total:</strong>${finalHours}</li>\r\n`;
            }
            funcionalidadelHtml += "\t</ul>\r\n";
            return funcionalidadelHtml;
        }
    } else {
        callback = (html, funcionalidadelHtml, funcionalidade, baseHourMultipler) => { 
            funcionalidadelHtml += "\t<ul>\r\n";
            for (let i = 0; i < funcionalidade.LoadedItems.length; i++) {
                const item = funcionalidade.LoadedItems[i];
                funcionalidadelHtml += `\t\t<li>${item.Titulo}</li>\r\n`;
            }
            funcionalidadelHtml += "\t</ul>\r\n";
            return funcionalidadelHtml;
        }
    }
    return doPrintFuncionalidades(projetoCodigo, includeHours, includeTotals, projetoCodigo + ".html", callback).then(result => {
        console.log("printAll DONE!");
        return result;
    }, error => {
        console.log("error printAll", error);
    });;
}

function doPrintFuncionalidades(projetoCodigo, includeHours, includeTotals, filename, printCallback) {
    return loadFullProjeto(projetoCodigo).then(projeto => {
        let html = "<ul>\r\n"
        if (includeHours) {
            let hours = 0;
            var baseHourMultipler = projeto["Fator Final"];
            for (let f = 0; f < projeto.LoadedFuncionalidades.length; f++) {
                const funcionalidade = projeto.LoadedFuncionalidades[f];
                const realHours = funcionalidade["Soma Diff"]* baseHourMultipler;
                const currentHours = Math.ceil(realHours * 100) / 100.0;
                partialHtml = `\t<li>${funcionalidade.Titulo} (${currentHours})`
                partialHtml = printCallback(html, partialHtml, funcionalidade, baseHourMultipler);
                partialHtml += "\t</li>\r\n";
                html += partialHtml;
                hours += realHours;
            }
            if (includeTotals) {
                const finalHours = Math.ceil(hours * 100) / 100.0;
                html += `\t<li class="sum"><strong>Total:</strong>${finalHours}</li>\r\n`;
            }
        } else {
            for (let f = 0; f < projeto.LoadedFuncionalidades.length; f++) {
                const funcionalidade = projeto.LoadedFuncionalidades[f];
                var partialHtml = `\t<li>${funcionalidade.Titulo}`
                partialHtml = printCallback(html, partialHtml, funcionalidade);
                partialHtml += "</li>\r\n";
                html += partialHtml;
            }
        }
        html += "</ul>";
        return writeToPrints(html, filename);
    }, error => {
        console.log("error printing");
    })
}

function printFuncionalidades(projetoCodigo, includeHours, includeTotals) {
    var callback = (html, partialHtml, funcionalidade) => { return partialHtml; };
    return doPrintFuncionalidades(projetoCodigo, includeHours, includeTotals, projetoCodigo+"-macro.html", callback).then(result => {
        console.log("printFuncionalidades DONE!");
        return result;
    }, error => {
        console.log("error printFuncionalidades", error);
    });;
}

// printFuncionalidades("282-A", true, true);
// printAll("282-A", true, true);