/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 *
 * Set of common handlers used for replication. All handlers adhere to the
 * API f(changelog, replContext, next)
 * where changelog is the replicated ldap changelog object, replContext is
 * the ReplContext object, and next is next handler in the chain. Al handlers
 * process.exit(1) on error.
 */

var log4js = require('log4js');


/**
 * Writes the checkpoint in changelog.object.changenumber to the datastore
 */
function writeCheckpoint(changelog, replContext, next) {
  var log = replContext.log4js.getLogger('common.js');
  log.debug('entering setcheckpoint with changelog %j', changelog.object);
  var checkpoint = replContext.checkpoint;
  var changenumber = changelog.object.changenumber;

  checkpoint.setCheckpoint(changenumber, function(err, res) {
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
function getCheckpoint(changelog, replContext, next) {
  var log = replContext.log4js.getLogger('common.js');
  log.debug('entering getCheckpoint with changelog %j', changelog.object);
  var changenumber = changelog.object.changenumber;
  var checkpoint = replContext.checkpoint;

  checkpoint.getCheckpoint(function(cp) {
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
function localSearch(changelog, replContext, next) {
  var log = replContext.log4js.getLogger('common.js');
  log.debug('entering localsearch wtih %j', changelog.object);
  var localClient = replContext.localClient;
  var targetDn = changelog.localDn;

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
      if (err.code === 32) {
        log.debug('%j does not exist locally, exiting', changelog.object, err);
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
        log.fatal('local entry %s does not have a objectclass attr', targetDn);
        process.exit(1);
      } else {
        log.debug('successfully exiting local search entry');
        return next();
      }
    });
  });
}

/**
 * Convert the incoming remote changelog targetdn in to the local dn.
 * since the root replication suffix is specified locally, it needs to be
 * appended. The dn is saved to changelog.localDn
 */
function convertDn(changelog, replContext, next) {
  var log = replContext.log4js.getLogger('common.js');
  changelog.localDn = changelog.object.targetdn + ', ' +
                      replContext.replSuffix;
  log.debug('converting targetdn %s to localdn %s',
            changelog.object.targetdn, changelog.localDn);
  return next();
}

/**
 * binds a ldap client given an user:pw string
 * @param auth: the user:pw string
 * @param client: the ldapjs client
 * @param log: the log object
 * @param callback: function(err)
 */
function bindClient(auth, client, log, callback) {
  if (!log) {
    log = log4js.getLogger('common.js');
  }
  auth = auth.split(':');
  log.debug('binding to client with creds %s, %s', auth[0], auth[1]);
  client.bind(auth[0], auth[1], function(err, res) {
    if (err) {
      log.error('unable to bind to local client', err);
      return callback(err);
    } else {
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