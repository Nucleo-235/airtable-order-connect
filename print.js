require('dotenv').config()
var AirtableBase = require('./airtable_base.js');
var extend = require('extend');
var fs = require('fs');

var defaultOptions = { 
    includeHours: false, 
    includeTotals: false,
    templateFile: "default.html",
    forceIncludeItems: false,
    groupPrefix: "",
    groupSufix: "",
};

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

function printULList(item, children, tabSize, beforeCallback, childCallback, afterCallback) {
    beforeCallback = beforeCallback ? beforeCallback : function(item, tab) { return ""; };
    childCallback = childCallback ? childCallback : function(item, child, childTab) { return `${childTab}\t${child.HTML}`; };
    afterCallback = afterCallback ? afterCallback : function(item, tab) { return ""; };

    var tab = "";
    for (let t = 0; t < tabSize; t++) {
        tab += "\t";
    }
    var childTab = tab + "\t";
    var containerTag = "ul";
    var childTag = "li";
    if (item.hasOwnProperty("asGroups") && item.asGroups) {
        containerTag = "div";
        childTag = "div";
    }
    var finalHTML = tab + `<${containerTag}>\r\n`;
    finalHTML += `${beforeCallback(item, tab)}`;

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        finalHTML += `${childTab}<${childTag}>\r\n`;
        finalHTML += `${childCallback(item, child, childTab)}`;
        if (child.children && child.children.length > 0) {
            const childHTML = printULList(child, child.children, tabSize + 2, beforeCallback, childCallback, afterCallback);
            finalHTML += childHTML;
        }
        finalHTML += `${childTab}</${childTag}>\r\n`;
    }

    finalHTML += `${afterCallback(item, tab)}`;
    finalHTML += tab + `</${containerTag}>\r\n`;
    return finalHTML;
}

function printTotals(item) {
    const finalHours = Math.ceil(item.hours * 100) / 100.0;
    return `<span class="sum"><strong>Total:</strong>${finalHours}</span>`;
}
function printFuncionalidadeSingle(funcionalidade, includeHours) {
    return includeHours ? `<span>${funcionalidade.Titulo} (${funcionalidade.currentHours})</span>` : `<span>${funcionalidade.Titulo}</span>`;
}

function shoudlPrintItem(item, includeHours) {
    return includeHours || (item["Descrição"] && item["Descrição"].length > 0);
}
function printItemSingle(item, includeHours) {
    if (includeHours) {
        return `<span>${item.Titulo} (${item.currentHours})</span>`
    } else {
        var titulo = item["Descrição"] && item["Descrição"].length > 0 ? item["Descrição"] : item.Titulo;
        return `<span>${titulo}</span>`;
    }
}

function funcionalidadesToHTMLList(owner, funcionalidades, options, printItems) {
    var tree = [];
    for (let f = 0; f < funcionalidades.length; f++) {
        const funcionalidade = funcionalidades[f];
        const treeFuncionalidade = { HTML: printFuncionalidadeSingle(funcionalidade, options.includeHours), children: [] };
        tree.push(treeFuncionalidade);

        if (printItems) {
            for (let i = 0; i < funcionalidade.LoadedItems.length; i++) {
                const item = funcionalidade.LoadedItems[i];
                if (options.forceIncludeItems || shoudlPrintItem(item, options.includeHours))
                    treeFuncionalidade.children.push({ HTML: printItemSingle(item, options.includeHours), children: [] });
            }
        }
    }
    if (options.includeTotals)
        tree.push({ HTML: printTotals(owner) });

    return tree;
}

function projetoToRecursiveHTMLList(projeto, options, printItems) {
    var tree;

    if (projeto.actorGroups.length > 1) {
        projeto.asGroups = true;
        tree = [];
        for (let g = 0; g < projeto.actorGroups.length; g++) {
            const group = projeto.actorGroups[g];
            const groupNode = { HTML: `<span>${options.groupPrefix}${group.name}${options.groupSufix}</span>` }
            groupNode.children = funcionalidadesToHTMLList(group, group.funcionalidades, options, printItems);
            tree.push(groupNode);
        }
        if (options.includeTotals)
            tree.push({ HTML: printTotals(projeto) });
    } else {
        tree = funcionalidadesToHTMLList(projeto, projeto.LoadedFuncionalidades, options, printItems);
    }
    return tree;
}

function addToPrintTemplate(content, templateFile) {
    var template = fs.readFileSync('./templates/' + templateFile, 'utf8');
    template = template.replace("__BODY_HERE__", content);
    return template;
}

function printProject(projetoCodigo, options, filename, printItems) {
    return AirtableBase.loadFullProjeto(projetoCodigo).then(projeto => {
        var treeNodes = projetoToRecursiveHTMLList(projeto, options, printItems);
        var finalULHTML = printULList(projeto, treeNodes);
        var html = addToPrintTemplate(`<h1>${projeto.Codigo}</h1>\r\n${finalULHTML}`, options.templateFile);
        return writeToPrints(html, filename);
    }, error => {
        console.log("error printing", error);
    })
}

function getFinalOptions(options) {
    return extend({}, defaultOptions, options);
}

function printFuncionalidades(projetoCodigo, options) {
    return printProject(projetoCodigo, getFinalOptions(options || {}), projetoCodigo+"-macro.html", false).then(result => {
        console.log("printFuncionalidades DONE!");
        console.log('open "./prints/' + projetoCodigo+'-macro.html"');
        return result;
    }, error => {
        console.log("error printFuncionalidades", error);
    });
}

function printAll(projetoCodigo, options) {
    return printProject(projetoCodigo, getFinalOptions(options || {}), projetoCodigo+"-complete.html", true).then(result => {
        console.log("printFuncionalidades DONE!");
        console.log('open "./prints/' + projetoCodigo+'-complete.html"');
        return result;
    }, error => {
        console.log("error printFuncionalidades", error);
    });
}

module.exports = {
    printAll, printFuncionalidades
};

// printFuncionalidades("000265-B - Intranet Refeita Alinha", { templateFile: 'apple_email.html' })
// printAll("000265-B - Intranet Refeita Alinha", { templateFile: 'apple_email.html' })
// printAll("000286-A - KPMG Gameficação", { templateFile: 'google_doc_order.html' })

// var printAir = require('./print')
// printAir.printFuncionalidades("000265-B - Intranet Refeita Alinha", { templateFile: 'apple_email.html' })
// printAir.printAll("000265-B - Intranet Refeita Alinha", { templateFile: 'apple_email.html' })
// printAir.printAll("000286-A - KPMG Gameficação", { templateFile: 'google_doc_order.html' })

// printAir.printAll("000265-C - Intranet Refeita Alinha", { templateFile: "word_contract.html", forceIncludeItems: true, groupPrefix: "Para os(as) ", groupSufix: "s: " });