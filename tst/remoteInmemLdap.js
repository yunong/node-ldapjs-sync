var inMemLdap = require('./inmemLdap');

inMemLdap.startServer({suffix: 'o=yunong', port: 23364}, function(){});