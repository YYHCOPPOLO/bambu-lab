import antfu from '@antfu/eslint-config'

export default antfu({
  vue: true,
  settings: {
    'import/core-modules': ['vue-router/auto-routes'],
  },
  globals: {
    definePage: 'readonly',
  },
})
