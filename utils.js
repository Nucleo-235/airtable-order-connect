function filterSpecific(projeto, projetoSpecificCode, otherCode) {
    const fixText = (value) => {
        return value.replace(new RegExp("\\[" + projetoSpecificCode + "\\] ", 'gi'), "").replace(new RegExp(projetoSpecificCode + "-", 'g'), "");
    }
    const fixFuncionalidade = funcionalidade => {
        funcionalidade.Codigo = fixText(funcionalidade.Codigo);
        if (funcionalidade.Titulo) funcionalidade.Titulo = fixText(funcionalidade.Titulo);
    };
    const fixItem = item => {
        item.Codigo = fixText(item.Codigo);
        if (item.Titulo) item.Titulo = fixText(item.Titulo);
        if (item["Descrição"]) item["Descrição"] = fixText(item["Descrição"]);
    };
    var funcionalidades = [];
    var removedFuncionalidades = [];
    for (const funcionalidade of projeto.LoadedFuncionalidades) {
        if (funcionalidade.Codigo.indexOf(projetoSpecificCode) > -1 || funcionalidade.Codigo.indexOf(otherCode) == -1) {
            fixFuncionalidade(funcionalidade);
            funcionalidades.push(funcionalidade);

            var items = [];
            var removedItems = [];
            var somaDiff = 0;
            for (const item of funcionalidade.LoadedItems) {
                if (item.Codigo.indexOf(projetoSpecificCode) > -1) {
                    fixItem(item);
                    items.push(item);
                    somaDiff += item["Resultado Qty"];
                } else if (item.Codigo.indexOf(otherCode) == -1) {
                    fixItem(item);
                    item["Resultado Qty"] = item["Resultado Qty"] / 2.0;
                    items.push(item);
                    somaDiff += item["Resultado Qty"];
                } else {
                    removedItems.push(item);
                }
            }
            funcionalidade.LoadedItems = items;
            funcionalidade.RemovedItems = removedItems;
            funcionalidade["Soma Diff"] = somaDiff;
        } else 
            removedFuncionalidades.push(funcionalidade);
    }
    projeto.LoadedFuncionalidades = funcionalidades;
    projeto.RemovedFuncionalidades = removedFuncionalidades;
    return projeto;
}

function filterRoupa(projeto) {
    return filterSpecific(projeto, "ROUPA", "SYB");
}

function filterSYB(projeto) {
    return filterSpecific(projeto, "SYB", "ROUPA");
}

printAir.printAll("Share Your Beer", { projectFilter: filterRoupa })
printAir.printAll("Share Your Beer", { projectFilter: filterSYB })

asana.saveAirtableToAsana("Share Your Beer", "Nucleo", "Roupa Livre", "Módulo 1", filterRoupa);