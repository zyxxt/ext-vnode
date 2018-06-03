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

// function generateFunction(str, sfvbox, options) {
//     if (/^[\w\.]+$/.test(str)) {
//         let data = options && options.data || sfvbox.$data;
//         let fn = generateDataField(str, sfvbox, data);
//         if (typeof fn === 'function') {
//             return fn.bind(sfvbox);
//         }
//
//         if (/^\w+$/.test(str)) {
//             if (typeof sfvbox[str] === 'function') {
//                 return sfvbox[str].bind(sfvbox);
//             }
//             if (typeof window[str] === 'function') {
//                 return (function () {
//                     window[str]()
//                 }).bind(sfvbox);
//             }
//         }
//         console.error(`function: ${str} not found`);
//         return EMPTY_FUNCTION;
//     }
//     if (/^\w+\(.*\)$/.test(str)) {
//         return generateExpression(str, sfvbox, options).bind(sfvbox);
//     }
// }

// function generateDataField(str, sfvbox, data) {
//     let keys = str.split('.');
//     for (let i = 0; i < keys.length; i++) {
//         if (!data) {
//             return;
//         }
//         data = data[keys[i]];
//     }
//     return data;
// }

function generateExpression(str, sfvbox, options) {
    let callError = false;
    let error;
    let fnBody = `
        var ret;
        with (this) {
            ret = ${str};
        }
        return ret;
    `;
    let fnWithoutEvent = new Function('values', 'xindex', 'xcount', fnBody);
    let fnWithEvent = new Function('event', 'values', 'xindex', 'xcount', fnBody);
    let tryCall = function (scope, event, values, xindex, xcount) {
        try {
            let ret;
            if (event instanceof Event) {
                ret = fnWithEvent.call(scope, event, values, xindex, xcount);
            } else {
                ret = fnWithoutEvent.call(scope, values, xindex, xcount);
            }
            return ret;
        } catch (e) {
            callError = true;
            error = e;
        }
    };

    options = options || {};
    return function (event) {
        let ret;
        let scopes = [options.data, sfvbox/*, window*/];
        for (let i = 0; i < scopes.length; i++) {
            ret = tryCall(scopes[i], event, options.values, options.xindex, options.xcount);
            if (!callError) {
                error = null;
                break;
            }
            callError = false;
        }

        if (error) {
            console.error(error);
        }
        return ret;
    };
}

function mergeAttribs (old, props) {
    let ret = Object.assign(old);
    for (let attr in props) {
        if (attr === 'attributes') {
            ret.attributes = ret.attributes || {};
            for (let k in props.attributes) {
                if (k === 'style') {
                    ret.attributes[k] += ';' + props.attributes[k];
                } else if (k === 'class') {
                    ret.attributes[k] += ' ' + props.attributes[k];
                } else {
                    ret.attributes[k] = props.attributes[k];
                }
            }
        } else if (attr === 'className') {
            ret.className = ret.className || '';
            ret.className += props.className;
        }
    }
    return ret;
}

function _astToAttr(astNode, sfvbox, options) {
    let ret = {
        attributes: {},
        events: {}
    };
    let attribs = astNode.attribs;

    for (let key in attribs) {
        if (attribs.hasOwnProperty(key)) {
            if (/^@/.test(key) && key.length > 1) {
                let eventName = key.slice(1);
                let eventFunction = generateExpression(attribs[key], sfvbox, options).bind(sfvbox);
                if (!/^\w+\(.*\)$/.test(attribs[key])) {
                    eventFunction = eventFunction();
                }
                if (typeof eventFunction !== 'function') {
                    console.error(`${key} must be a function`);
                    break;
                }
                eventFunction = eventFunction.bind(sfvbox);

                // ev-xxx 的意图不是添加事件，而是在createElement的时候可以hook钩子
                // ret[`ev-on${key.slice(1)}`] = generateExpression(attribs[key], sfvbox, options);
                
                ret[`on${eventName}`] = eventFunction;
                ret.events[eventName] = eventFunction;

            } else if (/^:/.test(key) && key.length > 1) {
                let attr = key.slice(1);
                ret.attributes[attr] = generateExpression(attribs[key], sfvbox, options)();
            } else if (key === 'class') {
                let classes = attribs[key].split(/\s+/g).map(cls => cls.trim()).filter(cls => cls);
                let className = [];
                classes.forEach(cls => {
                    let match = cls.match(/\{(.+)\}/);
                    if (match && match[1]) {
                        className.push(generateExpression(match[1], sfvbox, options)());
                    } else {
                        className.push(cls);
                    }
                });
                if (className.length) {
                    ret.className = className.join(' ');
                }
            } else {
                ret.attributes[key] = attribs[key].replace(/\{(.+)\}/g, function (match, expression) {
                    return generateExpression(expression, sfvbox, options)();
                });
            }
        }
    }

    if (sfvbox._props) {
        ret = mergeAttribs(ret, sfvbox._props);
        delete sfvbox._props;
    }

    return ret;
}


function isTag (astNode) {
    return astNode.type === 'tag';
}

function isText (astNode) {
    return astNode.type === 'text';
}


function isHtmlTag (astNode) {
    return isTag(astNode) && NORMAL_HTML_TAG.indexOf(astNode.name) !== -1;
}

function isTplHtmlTag (astNode) {
    return isTag(astNode) && astNode.name === 'tpl';
}

function isWidgetTag (astNode) {
    return isTag(astNode) && !isHtmlTag(astNode) && !isTplHtmlTag(astNode) && !isText(astNode);
}


function parseHtmlTagVNode (astNode, sfvbox, options) {
    if (!isHtmlTag(astNode)) {
        return;
    }
    return [h(astNode.name,
        _astToAttr(astNode, sfvbox, options),
        astNode.children && astToVNode(astNode.children, sfvbox, options) || []
    )];
}

function parseHtmlTextVNode (astNode, sfvbox, options) {
    if (!isText(astNode)) {
        return;
    }
    return [astNode.data.replace(/\{(.+)\}/g, function (match, expression) {
        return generateExpression(expression, sfvbox, options)();
    })];
}

function parseTplTagVNode (astNode, sfvbox, options) {
    if (!isTplHtmlTag(astNode)) {
        return;
    }

    // <tpl> 只处理逻辑，不生成dom节点，支持 if for 语法
    let attr = astNode.attribs;
    if (!attr) {
        return [astToVNode(astNode.children, sfvbox, options)];
    }

    if (attr.if) {
        if (generateExpression(attr.if, sfvbox, options)()) {
            return [astToVNode(astNode.children, sfvbox, options)];
        }
    }
    if (attr.for) {
        let ret = [];
        let list = generateExpression(attr.for, sfvbox, options)();
        if (Array.isArray(list)) {
            list.forEach((values, index) => {
                ret.push(astToVNode(astNode.children, sfvbox, {
                    data: values,
                    values,
                    xindex: index,
                    xcount: list.length
                }));
            })
        } else if (typeof list === 'object') {
            Object.keys(list).forEach((key, index, keys) => {
                ret.push(astToVNode(astNode.children, sfvbox, {
                    data: key,
                    values: list,
                    xindex: index,
                    xcount: keys.length
                }));
            });
        }
        return ret;
    }
}

function parseWidgetVNode (astNode, sfvbox, options) {
    if (!isWidgetTag(astNode)) {
        return;
    }
    
    let ComponentCtor = VBox.ComponentManager.get(astNode.name);
    if (!ComponentCtor) {
        console.error(`can not find widget: ${astNode.name}. you should reg first`);
        return;
    }

    let props = _astToAttr(astNode, sfvbox, options);
    if (props && props.attributes && props.attributes.key) {
        let exist = sfvbox._childrenMap.get(props.attributes.key);
        if (exist && !exist.isDestroyed) {
            exist.updateProps(props);
            return [exist];
        }
    }

    let comp = new ComponentCtor({
        $propsData: props
    });

    comp.$parent = sfvbox;
    sfvbox.$children.push(comp);
    if (props && props.attributes && props.attributes.key) {
        sfvbox._childrenMap.set(props.attributes.key, comp);
    }


    return [comp];
}

function astToVNode(astTree, sfvbox, options) {
    if (!Array.isArray(astTree)) {
        return;
    }
    let ret = [];
    let add = (ret, vnodes) => {
        if (Array.isArray(vnodes) && vnodes.length) {
            ret.push(...vnodes);
        }
    };
    astTree.forEach(astNode => {

        // HTML 节点
        add(ret, parseHtmlTagVNode(astNode, sfvbox, options));

        // <tpl> 节点
        add(ret, parseTplTagVNode(astNode, sfvbox, options));

        // 组件
        add(ret, parseWidgetVNode(astNode, sfvbox, options));

        // 文本
        add(ret, parseHtmlTextVNode(astNode, sfvbox, options));

    });
    return ret;
}

class VBox {

    constructor(options) {
        this.$data = null;
        this.$propsData = null;
        
        this.$parent = null;
        this.$children = [];
        this._childrenMap = new Map();

        Object.assign(this, options);
        this._initEvents();

        this._complie();
        this.created();

        // if (this.$el) {
        //     this.$mount(this.$el);
        // }
    }

    _initEvents () {
        this._events = {};
        if (this.$propsData) {
            this.updateProps(this.$propsData);
        }
    }

    $on (eventName, cb, scope) {
        let event = this._events[eventName];
        let callbacks = event && event.callbacks;
        if (!event) {
            callbacks = [];
            this._events[eventName] = {
                name: eventName,
                callbacks
            };
        }
        callbacks.push({cb, scope});
    }

    $emit (eventName, ...args) {
        let event = this._events[eventName];
        if (!event) {
            return;
        }
        event.callbacks.forEach(({ cb, scope }) => {
            if (scope) {
                cb.call(scope, ...args);
            } else {
                cb(...args);
            }
        });
    }

    init () {
        
        // The function called when the widget is being created. Should return a DOM Element

        return this.$mount();
    }

    update () {

        // The function called when the widget is being updated.
    }

    destroy () {
        this.$template = null;
        this.$el = null;
        this._ast = null;
        this.isDestroyed = true;
        this.$vnode = null;
        this.$root = null;
        this.$children = null;
        this.$parent = null;
        this._events = [];
        console.log('destroyed');

        this.destroyed();

        // The function called when the widget is being removed from the dom.
    }

    updateProps (propsData) {

        // 先删除已经添加的事件
        this._events = [];

        this.$propsData = propsData;
        this._props = propsData;

        if (propsData.events) {
            for (let eventName in propsData.events) {
                if (propsData.events.hasOwnProperty(eventName)) {
                    this.$on(eventName, propsData.events[eventName]);
                }
            }
        }
    }

    created () {

    }

    mounted () {

    }

    updated () {

    }

    destroyed () {

    }

    _complie() {
        if (!this.$template || this._templateCompile) {
            return;
        }
        let ast = parseAst(this.$template.trim());
        if (!Array.isArray(ast)) {
            console.error(`parse AST error`);
            return;
        }
        if (ast.length > 1) {
            console.error(`only one root allowed`);
            return;
        }
        this._ast = ast;
        this._templateCompile = true;

        return ast;
    }

    render(h) {
        return astToVNode(this._ast, this, {
            data: this.$data,
            propsData: this.$propsData
        });
    }

    $mount(el) {
        this._complie();
        this.$vnode = this.render(h)[0];
        this.$root = createElement(this.$vnode);
        this._mounted = true;
        this.mounted();

        // 当作为子组件时，不传el
        if (!el) {
            return this.$root;
        }

        if (typeof el === 'string') {
            el = document.getElementById(el);
        }
        el.appendChild(this.$root);
        return this.$root;
    }

    _update () {
        if (!this._mounted) {
            return;
        }
        let vnode = this.render(h)[0];
        let patches = diff(this.$vnode, vnode);
        this.$root = patch(this.$root, patches);
        this.$vnode = vnode;

        this.updated();
    }

    $forceUpdate () {
        this._update();
    }


}

// 不允许修改
VBox.prototype.type = 'Widget';

class ComponentManager {
    constructor () {
        this.components = new Map();
    }

    reg (name, sfvboxCtor) {
        if (NORMAL_HTML_TAG.indexOf(name.toLowerCase()) !== -1) {
            console.error(`can not reg a html tag component: ${name}`);
            return;
        }
        if (this.components.has(name)) {
            console.error(`component had reg: ${name}`, this.get(name));
            return;
        }

        this.components.set(name, sfvboxCtor);

    }

    unreg (name) {
        this.components.delete(name);
    }

    get (name) {
        return this.components.get(name);
    }

    clear () {
        this.components.clear();
    }
}


VBox.ComponentManager = new ComponentManager();
VBox.reg = VBox.ComponentManager.reg.bind(VBox.ComponentManager);
VBox.unreg = VBox.ComponentManager.unreg.bind(VBox.ComponentManager);

// VBox.component = function (name, config) {
//
// };



class Com extends VBox {

    constructor (config) {
        super(config);
        this.$template = '<div class="sub {cls}" a="b" style="background:red;" @click="onClick">qqqqqqqqqqqq</div>';
        this.$data = {
            cls: 'sub-component'
        };
    }

    created () {
        console.log(this.$propsData);
        this.$emit('www', 'a', 'bbb');
    }

    destroy () {
        super.destroy();
    }

    onClick () {
        console.log(this);
        this.$emit('click');
    }

}
VBox.reg('sub-comp', Com);

let testBox = new VBox({

    $template: `
        <div>
            <p>fdsfds: <span>{abc}</span><p>
            <p class="text-cls1" @click="alert(list[2])" a="fdsfds">aaaaa</p>
            <p class="text-cls2" @click="onClick">bbbbb</p>
            <tpl for="list">
                <tpl if="xindex === 0">
                    <div>kwgkkwgk</div>
                </tpl>
                <tpl if="typeof values === 'string'">
                    <p class="text-cls3" @click="onClick(event, values, xindex, xcount)">ccc: {values}</p>
                </tpl>
                <tpl if="typeof values === 'object'">
                    <p class="text-cls3" @click="alert(values.value)">ccc: {values.name}</p>
                </tpl>
            </tpl>
            <sub-comp key="abcdefg" options="{list}" :xxx="abc" class="rrrr" ppp="qqq" @www="onWww" @click="alert(abc)"></sub-comp>
        </div>
    `,



    $el: document.body,

    created() {
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

    onClick(event) {
        console.log(this, ...arguments);
    },

    onWww (a, b) {
        console.log(this, a, b);
    },

    refresh () {
        // this.$data = {
        //     abc: String(+new Date()),
        //     // list: Array.from(Array(Math.round(Math.random() * 5))).map(() => {
        //     //     return Math.random() < 0.3 ? Math.random() * 100 : Math.random() < 0.7 ? {
        //     //         name: +new Date()
        //     //     } : {
        //     //         value: 'xxx' + +new Date()
        //     //     };
        //     // })
        //     list: [
        //         +new Date(),
        //         +new Date(),
        //         {
        //             name: 'name' + +new Date(),
        //             value: 'value' + +new Date()
        //         }
        //     ]
        //
        // };
        this.$data = {
            abc: 'abcaaa',
            list: [
                12,
                'string',
                {
                    name: 'xxx',
                    value: 'valxxxue'
                }
            ]
        };
        this.$forceUpdate();
    }

});

testBox.$mount(document.body);

// setInterval(function () {
//     testBox.refresh();
// }, 1000);
