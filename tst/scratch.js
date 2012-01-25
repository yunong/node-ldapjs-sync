var ldap = require('ldapjs');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');
var ldapjsRiak = require('ldapjs-riak');
var ldapjsSync = require('../lib/index');


var SUFFIX = 'o=' + uuid();
var REMOTE_URL ='ldap://127.0.0.1:' + 12345 + '/' +
                SUFFIX + '??sub?(login=*)';
                
// init remote ldap
var remoteBackend = ldapjsRiak.createBackend({
  bucket: {
    name: uuid()
  },
  uniqueIndexBucket: {
    name: uuid()
  },
  indexes: {
    l: false,
    uid: true
  },
  client: {
    url: 'http://localhost:8098',
    cache: {
      size: 100,
      age: 20
    }
  },
  log4js: log4js
});

var remoteLdap = ldap.createServer({
  log4js: log4js
});

remoteLdap.add(SUFFIX, remoteBackend, remoteBackend.add());
remoteLdap.modify(SUFFIX, remoteBackend, remoteBackend.modify());
remoteLdap.bind(SUFFIX, remoteBackend, remoteBackend.bind());
remoteLdap.compare(SUFFIX, remoteBackend, remoteBackend.compare());
remoteLdap.del(SUFFIX, remoteBackend, remoteBackend.del());
remoteLdap.search(SUFFIX, remoteBackend, remoteBackend.search());

remoteLdap.listen(12345, function() {
  console.log('server listening at: %s\n\n', remoteLdap.url);
  console.log(SUFFIX);
  var client = ldap.createClient({
    url: REMOTE_URL
  });

  var entry = {
    cn: 'unit',
    objectClass: 'organization',
    o: 'test'
  };
  client.add(SUFFIX, entry, function(err, res) {
    client.search('cn=unit,' + SUFFIX, function(err, res) {
      console.log('search response', res);
      console.log('search err', err);
      res.on('end', function(entry) {
        console.log('search entry', entry);
      });
    });
  });
});