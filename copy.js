var Airtable = require('airtable');
var extend = require('extend');
var base = new Airtable({apiKey: process.env.API_KEY}).base('appdfAwtINoSYGqqD');

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

function getProjectRef(projetoCodigo, callback) {
    var result = null;
    base('Projetos').select({
        // Selecting the first 3 records in Grid view:
        maxRecords: 1,
        filterByFormula: `(SEARCH('${projetoCodigo}', Codigo) > 0)`,
    }).eachPage(function page(records, fetchNextPage) {
        // This function (`page`) will get called for each page of records.
    
        
        records.forEach(function(record) {
            result = record;
        });
    
        // To fetch the next page of records, call `fetchNextPage`.
        // If there are more records, `page` will get called again.
        // If there are no more records, `done` will get called.
        fetchNextPage();
    
    }, function done(err) {
        if (err) { console.error(err); return; }
        else { callback(result); }
    });
}

function doCopyFuncionalidade(funcionalidade, projetoTargetRef) {
    return new Promise((resolve, reject) => {
        var cloned = extend({}, funcionalidade);
        delete cloned["id"];
        delete cloned["_rawJson"];
        delete cloned["_table"];
        var validFields = ["Titulo", "Order", "Descricao"];
        var fieldKeys = Object.keys(cloned.fields);
        for (let f = 0; f < fieldKeys.length; f++) {
            const fieldKey = fieldKeys[f];
            if (validFields.indexOf(fieldKey) == -1) {
                delete cloned.fields[fieldKey];
            }
        }
        cloned.fields.Items = [];
        cloned.fields.Projeto = [projetoTargetRef.id];
        base('Funcionalidades').create(cloned.fields, function(err, record) {
            if (err) { console.error(err); return; }
            else { resolve(record); return; }
        }); 
    });
}

function doCopyItem(item, newFuncionalidadeRef, newProjetoRef) {
    return new Promise((resolve, reject) => {
        var cloned = extend({}, item);
        delete cloned["id"];
        delete cloned["_rawJson"];
        delete cloned["_table"];
        var validFields = ["Titulo", "Order", "Categoria", "Quantidade", "Já fiz?", "Dificuldade", "Trabalhoso?", "Estimativa", "Valor Extra", "Colaborador", "Status"];
        var fieldKeys = Object.keys(cloned.fields);
        for (let f = 0; f < fieldKeys.length; f++) {
            const fieldKey = fieldKeys[f];
            if (validFields.indexOf(fieldKey) == -1) {
                delete cloned.fields[fieldKey];
            }
        }
        cloned.fields.Funcionalidade = [newFuncionalidadeRef.id];
        cloned.fields["Já fiz?"] = "Não";
        // cloned.fields.Projeto = [newProjetoRef.id];
        console.log(cloned.fields);
        base('Items').create(cloned.fields, function(err, record) {
            if (err) { console.error(err); return; }
            else { console.log(record.id); resolve(record); return; }
        }); 
    });
}

function doLoadAndCopyItem(itemId, newFuncionalidadeRef, newProjetoRef) {
    return new Promise((resolve, reject) => {
        base('Items').find(itemId, function(err, record) {
            if (err) { 
                console.error(err);
                reject(err); 
                return; 
            } else {
                doCopyItem(record, newFuncionalidadeRef, newProjetoRef).then(resolve, reject);
            }
        });
    });
}

function copyFuncionalidade(funcionalidade, projetoTargetRef) {
    return new Promise((resolve, reject) => {
        var original = extend({}, funcionalidade.fields);
        doCopyFuncionalidade(funcionalidade, projetoTargetRef).then(clonedFuncionalidade => {
            const promises = [];
            // console.log('items', original.Items ? original.Items.length : null);
            for (let index = 0; index < original.Items.length; index++) {
                const itemId = original.Items[index];
                promises.push(doLoadAndCopyItem(itemId, clonedFuncionalidade, projetoTargetRef));
            }
            Promise.all(promises).then(resolve, reject);
        }, reject)
    });
}

function copyProject(projeto, projetoTarget) {
    return new Promise((resolve, reject) => {
        loadAllFuncionalidades(projeto, funcionalidades => {
            console.log('loadAllFuncionalidades', funcionalidades ? funcionalidades.length : null);
            getProjectRef(projetoTarget, newProjectRef => {
                console.log('getProjectRef', newProjectRef);
                const promises = [];
                for (let i = 0; i < funcionalidades.length; i++) {
                    const funcionalidade = funcionalidades[i];
                    promises.push(copyFuncionalidade(funcionalidade, newProjectRef));
                }
                Promise.all(promises).then(result => {
                    console.log('copied', result)
                    resolve(result);
                }, reject);
            })
        });
    });
}

// copyProject("000277-A", "000277-B - ");