/**
 * The remote LDAP server used to for unit tests,
 * spawn with $node <this_file_name>
 */

var ldap = require('ldapjs');
var log4js = require('log4js');
var uuid = require('node-uuid');
var ldapjsRiak = require('ldapjs-riak');
var ldapjsSync = require('../lib/index');

var SUFFIX = 'o=yunong';
var REMOTE_PORT = 23364;
var REMOTE_URL ='ldap://127.0.0.1:' + REMOTE_PORT + '/' +
                SUFFIX + '??sub?(uid=*)';

// mainline

var remoteBackend = ldapjsRiak.createBackend({
  bucket: {
    name: uuid()
  },
  uniqueIndexBucket: {
    name: uuid()
  },
  changelogBucket: {
    name: uuid()
  },
  indexes: {
    l: false,
    cn: false,
    o: false,
    uid: true,
    changenumber: true
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
remoteLdap.search('cn=changelog',
                  remoteBackend,
                  remoteBackend.changelogSearch());

remoteLdap.listen(REMOTE_PORT, function() {
  console.log('server listening at: %s\n\n', remoteLdap.url);
  remoteClient = ldap.createClient({
    url: REMOTE_URL,
    log4js: log4js
  });
});