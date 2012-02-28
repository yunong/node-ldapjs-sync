/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 *
 * Set of common handlers used for replication. All handlers adhere to the
 * API f(changelog, replicator, next)
 * where changelog is the replicated ldap changelog object, replicator is
 * the ReplContext object, and next is next handler in the chain. Al handlers
 * process.exit(1) on error.
 */

var bunyan = require('bunyan');
var ldapjs = require('ldapjs');


/**
 * Writes the checkpoint in changelog.object.changenumber to the datastore
 */
function writeCheckpoint(changelog, replicator, next) {
  var log = replicator.log;
  log.debug('entering setcheckpoint with changelog %j', changelog.object);
  var checkpoint = replicator.checkpoint;
  var changenumber = changelog.object.changenumber;

  checkpoint.set(changenumber, function(err, res) {
    if (err) {
      log.fatal('unable to set checkpoint', err);
      process.exit(1);
    }

    log.debug('successfully set checkpoint to %s', changenumber);
    return next();
  });
}

/**
 * Checks whether the changelog.object.changnumber is greater than the
 * current checkpoint.
 * Short circuits the handlers if false.
 */
function getCheckpoint(changelog, replicator, next) {
  var log = replicator.log;
  log.debug('entering getCheckpoint with changelog %j', changelog.object);
  var changenumber = changelog.object.changenumber;
  var checkpoint = replicator.checkpoint;

  checkpoint.get(function(cp) {
    // this changelog has already been replicated, skip this entry completely
    if (cp >= changenumber) {
      log.debug('changelog %j checkpoint %s, skipping',
                changelog.object, cp);
      return next(true);
    }

    log.debug('changelog %j is a candidiate for replication against ' +
              'checkpoint %s', changelog.object, cp);
    return next();
  });
}

/**
 * Search locally for the replicated entry in changelog.localDn. If the entry
 * exists, it's stored in changelog.localEntry.
 */
function localSearch(changelog, replicator, next) {
  var log = replicator.log;
  log.debug('entering localsearch wtih %j', changelog.object);
  var targetDn = changelog.localDn;

  replicator.localPool.acquire(function(err, localClient) {
    if (err) {
      self.log.fatal('unable to acquire client from pool', err);
      process.exit(1);
    }

    localClient.search(targetDn, { scope: 'base' }, function(err, res) {
      if (err) {
        log.fatal('localsearch unable to search', err);
        process.exit(1);
      }

      res.on('searchEntry', function(entry) {
        log.debug('got local search entry %j', entry.object);
        changelog.localEntry = entry;
      });

      res.on('error', function(err) {
        // no such object error
        if (err.code === ldapjs.LDAP_NO_SUCH_OBJECT) {
          log.debug('%j dne locallyexiting', changelog.object, err);
          replicator.localPool.release(localClient);
          return next();
        }
        log.fatal('error while local searching', err);
        process.exit(1);
      });

      res.on('end', function(res) {
        // check that the filter matched too, if the filter does not match,
        // end gets called but no entry is found.
        if (!changelog.localEntry) {
          // if there are no local entries, that means the DN exists but the
          // entry doesn't have the objectclass attr
          log.fatal('local entry %s has no objectclass attr', targetDn);
          process.exit(1);
        } else {
          log.debug('successfully exiting local search entry');
          replicator.localPool.release(localClient);
          return next();
        }
      });
    });

  });
}

/**
 * Convert the incoming remote changelog targetdn in to the local dn.
 * since the root replication suffix is specified locally, it needs to be
 * appended. The dn is saved to changelog.localDn
 */
function convertDn(changelog, replicator, next) {
  var log = replicator.log;
  // if the replSuffix is empty, this means we are replicating the tree
  // as is, so loacl dn = targetdn
  if (replicator.replSuffix === '') {
    changelog.localDn = changelog.object.targetdn;
  } else {
    changelog.localDn = changelog.object.targetdn + ', ' +
                        replicator.replSuffix;
  }

  log.debug('converting targetdn %s to localdn %s',
            changelog.object.targetdn, changelog.localDn);
  return next();
}

/**
 * binds a ldap client given an user:pw string
 * @param auth: the user:pw string.
 * @param client: the ldapjs client.
 * @param log: the log object.
 * @param callback: function(err).
 */
function bindClient(auth, client, log, callback) {
  if (!log) {
    log = new Bunyan({name: 'common.js'});
  }
  auth = auth.split(':');
  log.debug('binding to client with creds %s, %s', auth[0], auth[1]);
  client.bind(auth[0], auth[1], function(err, res) {
    if (err) {
      log.fatal('unable to bind to local client', err);
      process.exit(1);
    } else {
      log.debug('bound to client');
      return callback();
    }
  });
}


///--- Exports

module.exports = {
  getCheckpoint: getCheckpoint,
  writeCheckpoint: writeCheckpoint,
  localSearch: localSearch,
  bindClient: bindClient,
  convertDn: convertDn
};
