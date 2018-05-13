
const htmlparser = require('htmlparser2');

const h = require('virtual-dom/h');
const diff = require('virtual-dom/diff');
const patch = require('virtual-dom/patch');
const createElement = require('virtual-dom/create-element');

const EMPTY_FUNCTION = () => {};

const NORMAL_HTML_TAG = [
    'div', 'p', 'span', 'ul', 'li', 'ol', 'dd', 'dl', 'dt', 'table', 'tbody', 'thead', 'caption', 'th', 'tr', 'td',
    'i', 'map', 'input', 'img', 'textarea', 'object', 'em', 'button'
];

window.htmlparser = htmlparser;

function parseAst(html, options) {
    return htmlparser.parseDOM(html, options);
}

function generateFunction (str, sfvbox, data, values, xindex, xcount) {
    if (/^[\w\.]+$/.test(str)) {
        data = data || sfvbox.$data;
        let fn = generateDataField(str,  sfvbox, data);
        if (typeof fn === 'function') {
            return fn.bind(sfvbox);
        }

        if (/^\w+$/.test(str)) {
            if (typeof sfvbox[str] === 'function') {
                return sfvbox[str].bind(sfvbox);
            }
            if (typeof window[str] === 'function') {
                return (function () {window[str]()}).bind(sfvbox);
            }
        }
        console.error(`function: ${str} not found`);
        return EMPTY_FUNCTION;
    }
    if (/^\w+\(.*\)$/.test(str)) {
        return generateExpression(str, sfvbox, data, values, xindex, xcount).bind(sfvbox);
    }
}

function generateDataField (str, sfvbox, data) {
    let keys = str.split('.');
    for (let i = 0; i < keys.length; i++) {
        if (!data) {
            return;
        }
        data = data[keys[i]];
    }
    return data;
}

function generateExpression (str, sfvbox, data, values, xindex, xcount) {
    let callError = false;
    let error;
    let fn = new Function ('values', 'xindex', 'xcount', `
        var ret;
        with (this) {
            ret = ${str};
        }
        return ret;
    `);
    let tryCall = function (scope, values, xindex, xcount) {
        try {
            return fn.call(scope, values, xindex, xcount);
        } catch (e) {
            callError = true;
            error = e;
        }
    };
    
    return function () {
        let ret;
        ret = tryCall(data, values, xindex, xcount);
        if (callError) {
            callError = false;
            ret = tryCall(sfvbox, values, xindex, xcount);
            if (callError) {
                console.error(error);
            }
        }
        return ret;
    };
}

function _astToAttr (astNode, sfvbox, data, values, xindex, xcount) {
    let ret = {};
    for (let key in astNode.attribs) {
        if (/^@/.test(key)) {
            // ret[`ev-on${key.slice(1)}`] = generateFunction(astNode.attribs[key], sfvbox, data, values, xindex, xcount);
            ret[`on${key.slice(1)}`] = generateFunction(astNode.attribs[key], sfvbox, data, values, xindex, xcount);
        } else {
            ret[key] = astNode.attribs[key];
        }
    }
    return ret;
}

function astToVNode(astTree, sfvbox, data, values, xindex, xcount) {
    if (!Array.isArray(astTree)) {
        return;
    }
    let ret = [];
    astTree.forEach(node => {
        if (node.type === 'tag') {
            if (NORMAL_HTML_TAG.indexOf(node.name) !== -1) {
                ret.push(h(node.name, _astToAttr(node, sfvbox, data, values, xindex, xcount), node.children && astToVNode(node.children, sfvbox, data, values, xindex, xcount) || []));
            } else if (node.name === 'tpl') {
                let attr = node.attribs;
                if (!attr) {
                    ret.push(astToVNode(node.children, sfvbox, data, values, xindex, xcount));
                    return;
                }
                if (attr.if) {
                    if (generateExpression(attr.if, sfvbox, data, values, xindex, xcount)()) {
                        ret.push(astToVNode(node.children, sfvbox, data, values, xindex, xcount));
                        return;
                    }
                } else if (attr.for) {
                    let list = generateExpression(attr.for, sfvbox, data, values, xindex, xcount)();
                    if (Array.isArray(list)) {
                        list.forEach((values, index) => {
                            ret.push(astToVNode(node.children, sfvbox, values, values, index, list.length));
                        })
                    }
                }
            }
        } else if (node.type === 'text') {
            ret.push(node.data.replace(/\{(.+)\}/g, function (match, expression) {
                return generateExpression(expression, sfvbox, data, values, xindex, xcount)();
            }));
        }
        
    });
    return ret;
}

class VBox {

    constructor(options) {
        Object.assign(this, options);
        this.created();
        this._complie();

        if (this.el) {
            this.$mount(this.el);
        }
    }

    created () {}

    mounted () {}

    beforeDestroyed () {}

    destroyed () {}

    _complie() {
        let ast = parseAst(this.$tempate.trim());
        this._ast = ast;
    }

    render (h) {
        return astToVNode(this._ast, this, this.$data);
    }

    $mount (el) {
        if (typeof el === 'string') {
            el = document.getElementById(el);
        }
        this.$vnode = this.render(h)[0];
        this.$root = createElement(this.$vnode);
        el.appendChild(this.$root);
    }

    
}


let testBox = new VBox({

    $tempate: `
        <div>
            <p>fdsfds: <span>{abc}</span><p>
            <p class="text-cls1" @click="alert">aaaaa</p>
            <p class="text-cls2" @click="onClick">bbbbb</p>
            <tpl for="list">
                <tpl if="xindex === 0">
                    <div>kwgkkwgk</div>
                </tpl>
                <tpl if="values === 'string'">
                    <p class="text-cls3" @click="onClick(values, xindex, xcount)">ccc: {values}</p>
                </tpl>
                <tpl if="typeof values === 'object'">
                    <p class="text-cls3" @click="onClick">ccc: {values}</p>
                </tpl>
            </tpl>
        /div>
    `,

    el: document.body,

    created () {
        this.$data = {
            abc: 'abc',
            list: [
                1,
                'string',
                {
                    name: 'name',
                    value: 'value'
                }
            ]
        };
    },

    onClick (event) {
        console.log(event);
    }

});