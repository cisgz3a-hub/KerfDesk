const base = require('../../package.json').build;

module.exports = {
  ...base,
  win: {
    ...base.win,
    signAndEditExecutable: true,
    signtoolOptions: {
      ...(base.win && base.win.signtoolOptions ? base.win.signtoolOptions : {}),
      publisherName: 'LaserForge',
      signingHashAlgorithms: ['sha256'],
    },
  },
};
