var ldap = require('ldapjs');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');
var ldapjsRiak = require('ldapjs-riak');
var ldapjsSync = require('../lib/index');


///--- Globals

var SUFFIX = 'o=yunong';
var SOCKET = '/tmp/.' + uuid();
var REMOTE_PORT = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL ='ldap://127.0.0.1:' + REMOTE_PORT + '/' +
                SUFFIX + '??sub?(uid=*)';

var ALL_CHANGES_CTRL = new ldap.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

var suffix = {
  objectClass: ['top', 'organization'],
  o: SUFFIX.split('=')[1],
  uid: uuid()
};

var localBackend;
var localClient;
var localLdap;

var remoteBackend;
var remoteClient;
var remoteLdap;

var sync;


///--- Tests

test('setup-local', function(t) {
  // init local ldap
  localBackend = ldapjsRiak.createBackend({
    bucket: {
      name: uuid()
    },
    uniqueIndexBucket: {
      name: uuid()
    },
    indexes: {
      l: false,
      cn: false,
      o: false,
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
  t.ok(localBackend);
  localLdap = ldap.createServer();
  t.ok(localLdap);

  localLdap.add(SUFFIX, localBackend, localBackend.add());
  localLdap.modify(SUFFIX, localBackend, localBackend.modify());
  localLdap.bind(SUFFIX, localBackend, localBackend.bind());
  localLdap.compare(SUFFIX, localBackend, localBackend.compare());
  localLdap.del(SUFFIX, localBackend, localBackend.del());
  localLdap.search(SUFFIX, localBackend, localBackend.search());
  localLdap.listen(SOCKET, function() {
    localClient = ldap.createClient({
      socketPath: SOCKET
    });
    t.ok(localClient);
    t.end();
  });
});

test('setup-remote', function(t) {
  var spawn = require('child_process').spawn;
  remoteLdap = spawn('node', ['./tst/remoteldap.js']);

  remoteLdap.stdout.on('data', function (data) {
    console.log('stdout: ' + data);
  });

  remoteLdap.stderr.on('data', function (data) {
    console.log('stderr: ' + data);
  });

  remoteClient = ldap.createClient({
    url: REMOTE_URL,
    log4js: log4js
  });

  remoteClient.once('connect', function(err) {
    console.log('client connected');
    t.ok(remoteClient);
    t.end();
  });
});

test('add fixtures', function(t) {
  remoteClient.add(SUFFIX, suffix, function(err, res) {
    console.log('adding artifacts', err);
    if (err) {
      t.fail(err);
    }

    t.ifError(err);
    t.ok(res);
    t.equal(res.status, 0);
    if (TOTAL_ENTRIES === 0){
      t.end();
    }
    var finished = 0;
    for (var i = 0; i < TOTAL_ENTRIES; i++) {
      var entry = {
        cn: 'child' + i,
        objectClass: 'person',
        uid: 'child' + i,
        sn: 'test',
        l: i % 3 ? 'vancouver' : 'seattle'
      };
      console.log('adding entry', entry);
      remoteClient.add('cn=child' + i + ',' + SUFFIX, entry,
                        function(err, res) {
        t.ifError(err);
        if (err) {
          t.fail('error adding fixtures', err);
        }
        t.ok(res);
        t.equal(res.status, 0);
        console.log('add', finished);
        if (++finished === TOTAL_ENTRIES) {
          console.log('ending add fixtures');
          setTimeout(function() { t.end(); }, 1000);
        }
      });
    }
  });
});

test('delete child', function(t) {
  remoteClient.del('cn=child1,' + SUFFIX, function(err) {
    t.ifError(err);
    t.end();
  });
});

test('setup-sync', function(t) {
  sync = ldapjsSync.createSync({
    localClient: localClient,
    urls: REMOTE_URL,
    log4js: log4js
  });

 setTimeout(function() { t.end(); }, 3000);
});

test('add-sync', function(t) {
  console.log('verifying replication');
  var opts = {
    scope: 'sub'
  };

  localClient.search(SUFFIX, opts, function(err, res) {
    t.ifError(err);
    t.ok(res);

    var retrieved = 0;
    res.on('searchEntry', function(entry) {
      console.log('search entries', entry.object);
      retrieved++;
    });
    res.on('error', function(err) {
      console.log('add-sync err', err);
      t.fail(err);
    });
    res.on('end', function(res) {
      t.ok(res);
      t.ok(res instanceof ldap.SearchResponse);
      t.equal(res.status, 0);
      // not total_entries + 1 because we deleted one of the entries
      t.equal(retrieved, TOTAL_ENTRIES);
      t.end();
    });
  });
});

// test('cleanup', function(t) {
//     remoteLdap.kill('SIGHUP');

//     remoteLdap.on('exit', function (code) {
//       console.log('child process exited with code ' + code);
//       t.end();
//     });
// });