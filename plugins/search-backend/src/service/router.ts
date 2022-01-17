/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express from 'express';
import Router from 'express-promise-router';
import { Logger } from 'winston';
import { Config } from '@backstage/config';
import { IdentityClient } from '@backstage/plugin-auth-backend';
import { PermissionAuthorizer } from '@backstage/plugin-permission-common';
import { SearchQuery, SearchResultSet } from '@backstage/search-common';
import {
  DocumentTypeInfo,
  SearchEngine,
} from '@backstage/plugin-search-backend-node';
import { AuthorizedSearchEngine } from './AuthorizedSearchEngine';

export type RouterOptions = {
  engine: SearchEngine;
  types: Record<string, DocumentTypeInfo>;
  permissions: PermissionAuthorizer;
  config: Config;
  logger: Logger;
};

const allowedLocationProtocols = ['http:', 'https:'];

export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { engine: inputEngine, types, permissions, config, logger } = options;

  const engine = config.getOptionalBoolean('permissions.enabled')
    ? new AuthorizedSearchEngine(inputEngine, types, permissions, config)
    : inputEngine;

  const filterResultSet = ({ results, ...resultSet }: SearchResultSet) => ({
    ...resultSet,
    results: results.filter(result => {
      const protocol = new URL(result.document.location, 'https://example.com')
        .protocol;
      const isAllowed = allowedLocationProtocols.includes(protocol);
      if (!isAllowed) {
        logger.info(
          `Rejected search result for "${result.document.title}" as location protocol "${protocol}" is unsafe`,
        );
      }
      return isAllowed;
    }),
  });

  const router = Router();
  router.get(
    '/query',
    async (
      req: express.Request<any, unknown, unknown, SearchQuery>,
      res: express.Response<SearchResultSet>,
    ) => {
      logger.info(
        `Search request received: term="${
          req.query.term
        }", filters=${JSON.stringify(req.query.filters)}, types=${
          req.query.types ? req.query.types.join(',') : ''
        }, pageCursor=${req.query.pageCursor ?? ''}`,
      );

      const token = IdentityClient.getBearerToken(req.header('authorization'));

      try {
        const resultSet = await engine?.query(req.query, { token });

        res.send(filterResultSet(resultSet));
      } catch (err) {
        throw new Error(
          `There was a problem performing the search query. ${err}`,
        );
      }
    },
  );

  return router;
}
