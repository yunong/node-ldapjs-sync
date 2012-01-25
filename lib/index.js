/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved
 */

var Sync = require('./sync.js');


module.exports = {
  
  Sync: Sync,
  createSync: function(options) {
    return new Sync(options);
  }
};