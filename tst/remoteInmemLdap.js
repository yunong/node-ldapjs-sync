/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var inMemLdap = require('../lib/inMemLdap');

inMemLdap.startServer({suffix: 'o=yunong', port: 23364}, function() {});
