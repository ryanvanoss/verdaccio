import _ from 'lodash';
import buildDebug from 'debug';
import { logger } from '@verdaccio/logger';
import { IAuth } from '@verdaccio/auth';
import { searchUtils } from '@verdaccio/core';
import { HTTP_STATUS } from '@verdaccio/commons-api';
import { Storage } from '@verdaccio/store';
import { Package } from '@verdaccio/types';

const debug = buildDebug('verdaccio:api:search');

/**
 * Endpoint for npm search v1
 * Empty value
 *  - {"objects":[],"total":0,"time":"Sun Jul 25 2021 14:09:11 GMT+0000 (Coordinated Universal Time)"}
 * req: 'GET /-/v1/search?text=react&size=20&frpom=0&quality=0.65&popularity=0.98&maintenance=0.5'
 */
export default function (route, auth: IAuth, storage: Storage): void {
  function checkAccess(pkg: any, auth: any, remoteUser): Promise<Package | null> {
    return new Promise((resolve, reject) => {
      auth.allow_access({ packageName: pkg?.package?.name }, remoteUser, function (err, allowed) {
        if (err) {
          if (err.status && String(err.status).match(/^4\d\d$/)) {
            // auth plugin returns 4xx user error,
            // that's equivalent of !allowed basically
            allowed = false;
            return resolve(null);
          } else {
            reject(err);
          }
        } else {
          return resolve(allowed ? pkg : null);
        }
      });
    });
  }

  route.get('/-/v1/search', async (req, res, next) => {
    let [size, from] = ['size', 'from'].map((k) => req.query[k]);
    let data;

    size = parseInt(size, 10) || 20;
    from = parseInt(from, 10) || 0;

    try {
      data = await storage.searchManager?.search({
        query: req.query,
        url: req.url,
      });
      debug('stream finish');
      const checkAccessPromises: searchUtils.SearchItemPkg[] = await Promise.all(
        data.map((pkgItem) => {
          return checkAccess(pkgItem, auth, req.remote_user);
        })
      );

      const final: searchUtils.SearchItemPkg[] = checkAccessPromises
        .filter((i) => !_.isNull(i))
        .slice(from, size);
      logger.debug(`search results ${final?.length}`);

      const response: searchUtils.SearchResults = {
        objects: final,
        total: final.length,
        time: new Date().toUTCString(),
      };

      res.status(HTTP_STATUS.OK).json(response);
    } catch (error) {
      logger.error({ error }, 'search endpoint has failed @{error.message}');
      next(next);
      return;
    }
  });
}
