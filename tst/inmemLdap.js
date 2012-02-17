var ldap = require('ldapjs');

var PersistentSearch = ldap.PersistentSearch;
///--- Globals

var SUFFIX;
var db = {};
var server = ldap.createServer();
var changelog = {};
var changenumber = 0;
var parseDN = ldap.parseDN;
var PS = new ldap.PersistentSearch();
var CHANGELOG_DN = parseDN('cn=changelog');
///--- Shared handlers

function authorize(req, res, next) {
  if (!req.connection.ldap.bindDN.equals('cn=root'))
    return next(new ldap.InsufficientAccessRightsError());

  return next();
}

function ISODateString() {
  function pad(n) {
    return n < 10 ? '0' + n : n;
  }

  var d = new Date();

  return d.getUTCFullYear() + '-' +
    pad(d.getUTCMonth() + 1) + '-' +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) + ':' +
    pad(d.getUTCMinutes()) + ':' +
    pad(d.getUTCSeconds()) + 'Z';
}

function updatePersistentSearchClients(req, res, next) {
  var dn = req.dn.toString();
  // notify all pertinent clients of change
  // also check that the request.dn is for the changelog,
  // if so, handle differently
  // console.log("PS CLIENTS", PS.clientList[0]);
  PS.clientList.forEach(function(client) {
    // console.log('PS', client);
    // see if the change type of the PS request is the same as the current req
    if (PersistentSearch.checkChangeType(client.req, req.type)) {
      var control =
        PersistentSearch.getEntryChangeNotificationControl(client.req,
                                                           res.changelog);
      var entry;
      if (client.req.dn.equals(CHANGELOG_DN)) {
        entry = res.changelog;
      } else {
        entry = res.psentry;
      }

      client.res.send(entry);
    }
  });

  return next();
}

function changelogHandler(req, res, next) {
  var changeType;
  switch (req.type) {
    case ('AddRequest'):
      changeType = 'add';
      break;
    case ('DeleteRequest'):
      changeType = 'delete';
      break;
    case ('ModifyRequest'):
      changeType = 'modify';
      break;
    default:
      return next();
  }

  var cn = ++changenumber;
  var dn = 'changenumber=' + cn + ', cn=changelog';
  var entry = {
    dn: dn,
    attributes: {
      targetdn: req.dn.toString(),
      changetime: ISODateString(),
      changenumber: cn,
      changetype: changeType,
    }
  };

  if (changeType === 'modify') {
    var changes = [];
    req.changes.forEach(function(c) {
      if (c.modification.type.toLowerCase() === 'userpassword')
        c.modification.vals = ['XXXXXX'];
      changes.push(c.json);
    });

    entry.attributes.changes = JSON.stringify(changes);
    entry.attributes.objectclass = 'changeLogEntry';
    entry.attributes.entry = JSON.stringify(db[entry.attributes.targetdn]);
  } else if (changeType === 'add') {
    var obj = req.toObject();
    if (obj.attributes.userpassword)
      obj.attributes.userpassword = 'XXXXXX';
    entry.attributes.changes = JSON.stringify(obj.attributes);
    entry.attributes.objectclass = 'changeLogEntry';
    entry.objectclass = 'changeLogEntry';
  } else {
    entry.attributes.objectclass = 'changeLogEntry';
  }

  // tack changelog entry to the response object
  res.changelog = entry;
  console.log('persisting changelog', entry);
  changelog[dn] = entry;
  console.log('added changelog %j', changelog[dn]);
  return next();
}

function startServer(options, callback) {
  SUFFIX = options.suffix;
  var port = options.port;

  server.bind('cn=root', function(req, res, next) {
    if (req.dn.toString() !== 'cn=root' || req.credentials !== 'secret')
      return next(new ldap.InvalidCredentialsError());

    res.end();
    return next();
  });

  server.add(SUFFIX, authorize, function(req, res, next) {
    var dn = req.dn.toString();
    console.log('dn', dn);
    if (db[dn])
      return next(new ldap.EntryAlreadyExistsError(dn));

    db[dn] = req.toObject().attributes;
    console.log('added %j', db[dn]);
    res.end();
    return next();
  }, changelogHandler, updatePersistentSearchClients);

  server.bind(SUFFIX, function(req, res, next) {
    var dn = req.dn.toString();
    if (!db[dn])
      return next(new ldap.NoSuchObjectError(dn));

    if (!dn[dn].userpassword)
      return next(new ldap.NoSuchAttributeError('userPassword'));

    if (db[dn].userpassword !== req.credentials)
      return next(new ldap.InvalidCredentialsError());

    res.end();
    return next();
  });

  server.compare(SUFFIX, authorize, function(req, res, next) {
    var dn = req.dn.toString();
    if (!db[dn])
      return next(new ldap.NoSuchObjectError(dn));

    if (!db[dn][req.attribute])
      return next(new ldap.NoSuchAttributeError(req.attribute));

    var matches = false;
    var vals = db[dn][req.attribute];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] === req.value) {
        matches = true;
        break;
      }
    }

    res.end(matches);
    return next();
  });

  server.del(SUFFIX, authorize, function(req, res, next) {
    var dn = req.dn.toString();
    if (!db[dn])
      return next(new ldap.NoSuchObjectError(dn));

    delete db[dn];

    res.end();
    return next();
  }, changelogHandler, updatePersistentSearchClients);

  server.modify(SUFFIX, authorize, function(req, res, next) {
    var dn = req.dn.toString();
    if (!req.changes.length)
      return next(new ldap.ProtocolError('changes required'));
    if (!db[dn])
      return next(new ldap.NoSuchObjectError(dn));

    var entry = db[dn];

    for (var i = 0; i < req.changes.length; i++) {
      mod = req.changes[i].modification;
      console.log('modification', mod);
      console.log('modification json', mod.json);
      console.log('modification entry', entry);
      switch (req.changes[i].operation) {
      case 'replace':
        if (!entry[mod.type])
          return next(new ldap.NoSuchAttributeError(mod.type));

        if (!mod.vals || !mod.vals.length) {
          delete entry[mod.type];
        } else {
          entry[mod.type] = mod.vals;
        }

        break;

      case 'add':
        if (!entry[mod.type]) {
          entry[mod.type] = mod.vals;
        } else {
          mod.vals.forEach(function(v) {
            if (entry[mod.type].indexOf(v) === -1)
              entry[mod.type].push(v);
          });
        }

        break;

      case 'delete':
        if (!entry[mod.type])
          return next(new ldap.NoSuchAttributeError(mod.type));

        delete entry[mod.type];

        break;
      }
    }
    console.log('modified entry looks like', db[dn]);
    res.end();
    return next();
  }, changelogHandler, updatePersistentSearchClients);

  server.search(SUFFIX, authorize, function(req, res, next) {
    console.log('searching filter', req.filter.toString());
    console.log('search scope', req.scope);
    var dn = req.dn.toString();
    if (!db[dn])
      return next(new ldap.NoSuchObjectError(dn));

    var scopeCheck;

    console.log('entry ', db[dn]);
    switch (req.scope) {
    case 'base':
      console.log('does it match? ', req.filter.matches(db[dn]));
      if (req.filter.matches(db[dn])) {
        console.log('search filter matches, sending search', db[dn]);
        res.send({
          dn: dn,
          attributes: db[dn]
        });
      }
      console.log('ending search response');
      res.end();
      console.log('calling next');
      return next();

    case 'one':
      scopeCheck = function(k) {
        if (req.dn.equals(k))
          return true;

        var parent = ldap.parseDN(k).parent();
        return (parent ? parent.equals(req.dn) : false);
      };
      break;

    case 'sub':
      scopeCheck = function(k) {
        return (req.dn.equals(k) || req.dn.parentOf(k));
      };

      break;
    }

    Object.keys(db).forEach(function(key) {
      if (!scopeCheck(key))
        return;

      if (req.filter.matches(db[key])) {
        console.log('sending', db[key]);
        res.send({
          dn: key,
          attributes: db[key]
        });
      }
    });

    res.end();
    return next();
  });

  server.search('cn=changelog', authorize, function(req, res, next) {
    // intercept the search request and figure out if it's persistent
    req.controls.forEach(function(c) {
      if (c.type === '2.16.840.1.113730.3.4.3') { // persistent search control
        req.persistentSearch = c;
      }
    });

    if (req.persistentSearch && req.persistentSearch.value.changesOnly) {
      // short circuit search if it's changes only
        return next();
    }

    var dn = req.dn.toString();
    console.log('searching for changelog', dn);
    console.log('with filter %j', req.filter);

    var scopeCheck;
    console.log('request scope', req.scope);
    switch (req.scope) {
    case 'base':
      if (!changelog[dn]){
        console.log('changelog %s dne', dn);
        return next(new ldap.NoSuchObjectError(dn));
      }
      if (req.filter.matches(changelog[dn])) {
        res.send({
          dn: dn,
          attributes: changelog[dn]
        });
      }

      res.end();
      return next();

    case 'one':
      scopeCheck = function(k) {
        if (req.dn.equals(k))
          return true;

        var parent = ldap.parseDN(k).parent();
        return (parent ? parent.equals(req.dn) : false);
      };
      break;

    case 'sub':
      console.log('in sub scope');
      scopeCheck = function(k) {
        return (req.dn.equals(k) || req.dn.parentOf(k));
      };

      break;
    }
    Object.keys(changelog).forEach(function(key) {
      console.log('scopecheck', scopeCheck(key));
      if (!scopeCheck(key))
        return;
      console.log('matching key', changelog[key]);
      if (req.filter.matches(changelog[key].attributes)) {
        console.log('sending', changelog[key]);
        res.send({
          dn: key,
          attributes: changelog[key].attributes
        });
      }
    });

    // don't end the connection if the request is persistent search
    if (req.persistentSearch) {
      // do not close the connection and register the req and res
      PS.addClient(req, res);
      res.connection.addListener('end', function() {
        // deregister the connection
        PS.removeClient(req, res);
      });
    } else {
      res.end();
    }
    return next();
  });

  ///--- Fire it up

  server.listen(port, function() {
    console.log('LDAP server up at: %s', server.url);
    callback(server);
  });
}

///--- Exports

module.exports = {
  startServer: startServer
};