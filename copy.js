require('dotenv').config()
var AirtableBase = require('./airtable_base.js');
var extend = require('extend');
var fs = require('fs');

function doCopyFuncionalidade(funcionalidade, projetoTargetRef) {
    return new Promise((resolve, reject) => {
        var cloned = extend({}, funcionalidade);
        delete cloned["id"];
        delete cloned["_rawJson"];
        delete cloned["_table"];
        var validFields = ["Titulo", "Order", "Descricao", "Ator"];
        var fieldKeys = Object.keys(cloned.fields);
        for (let f = 0; f < fieldKeys.length; f++) {
            const fieldKey = fieldKeys[f];
            if (validFields.indexOf(fieldKey) == -1) {
                delete cloned.fields[fieldKey];
            }
        }
        cloned.fields.Items = [];
        cloned.fields.Projeto = [projetoTargetRef.id];
        AirtableBase.main_base('Funcionalidades').create(cloned.fields, function(err, record) {
            if (err) { console.error(err); return; }
            else { resolve(record); return; }
        }); 
    });
}

function doCopyItem(item, newFuncionalidadeRef, newProjetoRef) {
    return new Promise((resolve, reject) => {
        try {
            var cloned = extend({}, item);
            delete cloned["id"];
            delete cloned["_rawJson"];
            delete cloned["_table"];
            var validFields = ["Titulo", "Order", "Categoria", "Descrição", "Quantidade", "Já fiz?", "Dificuldade", "Trabalhoso?", "Estimativa", "Valor Extra", "Colaborador", "Status"];
            var fieldKeys = Object.keys(cloned.fields);
            for (let f = 0; f < fieldKeys.length; f++) {
                const fieldKey = fieldKeys[f];
                if (validFields.indexOf(fieldKey) == -1) {
                    delete cloned.fields[fieldKey];
                }
            }
            cloned.fields.Funcionalidade = [newFuncionalidadeRef.id];
            // cloned.fields["Já fiz?"] = "Não";
            // cloned.fields.Projeto = [newProjetoRef.id];
            console.log(cloned.fields);
            AirtableBase.main_base('Items').create(cloned.fields, function(err, record) {
                if (err) { console.error(err); reject(err); return; }
                else { console.log(record.id); resolve(record); return; }
            }); 
        } catch (ex) {
            console.log('doCopyItem', ex);
            reject(ex);
        }
    });
}

function doAddEmptyItem(funcionalidadeRef) {
    return new Promise((resolve, reject) => {
        var item = { fields: {} };
        var validFields = ["Titulo", "Order", "Categoria", "Descrição", "Quantidade", "Já fiz?", "Dificuldade", "Trabalhoso?", "Estimativa", "Valor Extra", "Colaborador", "Status"];
        item.fields.Titulo = "";
        item.fields.Quantidade = 1;
        if (funcionalidadeRef.fields && funcionalidadeRef.fields.Order) {
            item.fields.Order = funcionalidadeRef.fields.Order * 10;
            if (funcionalidadeRef.fields.Items && funcionalidadeRef.fields.Items.length > 0)
                item.fields.Order = item.fields.Order + funcionalidadeRef.fields.Items.length;
        }
        
        item.fields.Funcionalidade = [funcionalidadeRef.id];
        // cloned.fields["Já fiz?"] = "Não";
        // cloned.fields.Projeto = [newProjetoRef.id];
        console.log(item.fields);
        AirtableBase.main_base('Items').create(item.fields, function(err, record) {
            if (err) { console.error(err); return; }
            else { 
                if (!funcionalidadeRef.fields.Items)
                    funcionalidadeRef.fields.Items = [];
                funcionalidadeRef.fields.Items.push(record);
                console.log(record.id); 
                resolve(record); 
                return; 
            }
        }); 
    });
}

function doLoadAndCopyItem(itemId, newFuncionalidadeRef, newProjetoRef) {
    return new Promise((resolve, reject) => {
        AirtableBase.find('Items', itemId).then(record => {
            console.log(record);
            doCopyItem(record, newFuncionalidadeRef, newProjetoRef).then(resolve, err => {
                console.log('doCopyItem err', err);
                reject(err);
            });
        }, err => {
            console.log('find err', err);
            reject(err);
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
        AirtableBase.loadAllFuncionalidades(projeto, funcionalidades => {
            console.log('loadAllFuncionalidades', funcionalidades ? funcionalidades.length : null);
            AirtableBase.getProjectRef(projetoTarget).then(newProjectRef => {
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
            }, reject)
        });
    });
}

function addEmptyItemToFuncion(funcionalidade, projetoTargetRef) {
    return new Promise((resolve, reject) => {
        var original = extend({}, funcionalidade.fields);
        if (original.Items && original.Items.length > 0) {
            resolve(true);
        } else {
            doAddEmptyItem(funcionalidade);
        }
    });
}

function addInitialItemsToProject(projetoTarget) {
    return new Promise((resolve, reject) => {
        AirtableBase.loadAllFuncionalidades(projetoTarget, funcionalidades => {
            console.log('loadAllFuncionalidades', funcionalidades ? funcionalidades.length : null);
            AirtableBase.getProjectRef(projetoTarget).then(projectRef => {
                console.log('getProjectRef', projectRef);
                const promises = [];
                for (let i = 0; i < funcionalidades.length; i++) {
                    const funcionalidade = funcionalidades[i];
                    promises.push(addEmptyItemToFuncion(funcionalidade, projectRef));
                }
                Promise.all(promises).then(result => {
                    console.log('added', result)
                    resolve(result);
                }, reject);
            }, reject);
        });
    });
}

// copyProject("000287-A - Novas Lojas Magazine Luiza Op Usando Tema Pronto", "000287-A - Novas Lojas Magazine Luiza Op HTML a partir de Design Personalizado")
// addInitialItemsToProject("000292-A - Plataforma EAD")
// copyProject("000279-A - KPMG Site/App Op Escopo Fechado", "000279-B - KPMG Site/App Op Escopo Fechado")