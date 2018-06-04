module.exports = {
    root: true,

    parser: 'babel-eslint',
    parserOptions: {
        ecmaVersion: 6,
        sourceType: 'module'
    },

    env: {
        browser: true,
        commonjs: true,
        es6: true
    },

    extends: [
        'plugin:@cgroup/sfchecklist/checklist',
        'plugin:@cgroup/sfchecklist/enhance'
    ],

    plugins: [
        'html',
        '@cgroup/sfchecklist'
    ],

    globals: {
        Ext: true,
        SF: true,
        Sinfor: true,
        AD: true,
        _: true,
        process: true,
        ace: true
    },

    'rules': {
        'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,

        // 函数复杂度改成更小的5
        'sfchecklist/max-coupling': ['error', {
            maxFanOut: 5
        }],

        // extjs 主要都是用scope来控制this的指向，没有必要，这里关闭掉
        'sfchecklist/no-use-this': 0
    }
}
