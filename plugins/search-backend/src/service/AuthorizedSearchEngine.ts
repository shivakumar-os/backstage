/*
 * Copyright 2022 The Backstage Authors
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

import { compact, zipObject } from 'lodash';
import DataLoader from 'dataloader';
import {
  AuthorizeDecision,
  AuthorizeQuery,
  AuthorizeResult,
  PermissionAuthorizer,
} from '@backstage/plugin-permission-common';
import {
  IndexableDocument,
  QueryRequestOptions,
  QueryTranslator,
  SearchEngine,
  SearchQuery,
  SearchResult,
  SearchResultSet,
} from '@backstage/search-common';
import { DocumentTypeInfo } from '@backstage/plugin-search-backend-node';
import { Config } from '@backstage/config';

export function decodePageCursor(pageCursor?: string): { page: number } {
  if (!pageCursor) {
    return { page: 0 };
  }

  return {
    page: Number(Buffer.from(pageCursor, 'base64').toString('utf-8')),
  };
}

export function encodePageCursor({ page }: { page: number }): string {
  return Buffer.from(`${page}`, 'utf-8').toString('base64');
}

export class AuthorizedSearchEngine implements SearchEngine {
  private readonly pageSize: number = 25;
  private readonly queryLatencyBudgetMs: number;

  constructor(
    private readonly searchEngine: SearchEngine,
    private readonly types: Record<string, DocumentTypeInfo>,
    private readonly permissions: PermissionAuthorizer,
    config: Config,
  ) {
    this.queryLatencyBudgetMs =
      config.getOptionalNumber('search.permissions.queryLatencyBudgetMs') ??
      1000;
  }

  setTranslator(translator: QueryTranslator): void {
    this.searchEngine.setTranslator(translator);
  }

  async index(type: string, documents: IndexableDocument[]): Promise<void> {
    this.searchEngine.index(type, documents);
  }

  async query(
    query: SearchQuery,
    options: QueryRequestOptions,
  ): Promise<SearchResultSet> {
    const queryStartTime = Date.now();

    const authorizer = new DataLoader((requests: readonly AuthorizeQuery[]) =>
      this.permissions.authorize(requests.slice(), options),
    );

    const requestedTypes = query.types || Object.keys(this.types);
    const typeDecisions = zipObject(
      requestedTypes,
      await Promise.all(
        requestedTypes.map(type => {
          const permission = this.types[type].visibilityPermission;

          return permission
            ? authorizer.load({ permission })
            : { result: AuthorizeResult.ALLOW as const };
        }),
      ),
    );

    const authorizedTypes = requestedTypes.filter(
      type => typeDecisions[type]?.result !== AuthorizeResult.DENY,
    );

    const { page } = decodePageCursor(query.pageCursor);
    const targetResults = (page + 1) * this.pageSize;

    let filteredResults: SearchResult[] = [];
    let nextPageCursor: string | undefined;
    let latencyBudgetExhausted: boolean;

    do {
      const nextPage = await this.searchEngine.query(
        { ...query, types: authorizedTypes, pageCursor: nextPageCursor },
        options,
      );

      filteredResults = filteredResults.concat(
        await this.filterResults(nextPage.results, typeDecisions, authorizer),
      );

      nextPageCursor = nextPage.nextPageCursor;
      latencyBudgetExhausted =
        Date.now() - queryStartTime > this.queryLatencyBudgetMs;
    } while (
      nextPageCursor &&
      filteredResults.length < targetResults &&
      !latencyBudgetExhausted
    );

    return {
      results: filteredResults.slice(
        page * this.pageSize,
        (page + 1) * this.pageSize,
      ),
      previousPageCursor:
        page === 0 ? undefined : encodePageCursor({ page: page - 1 }),
      nextPageCursor:
        !latencyBudgetExhausted &&
        (nextPageCursor || filteredResults.length > targetResults)
          ? encodePageCursor({ page: page + 1 })
          : undefined,
    };
  }

  private async filterResults(
    results: SearchResult[],
    typeDecisions: Record<string, AuthorizeDecision>,
    authorizer: DataLoader<AuthorizeQuery, AuthorizeDecision>,
  ) {
    return compact(
      await Promise.all(
        results.map(result => {
          if (typeDecisions[result.type]?.result === AuthorizeResult.ALLOW) {
            return result;
          }

          const permission = this.types[result.type].visibilityPermission;
          const resourceRef = result.document.authorization?.resourceRef;

          if (!permission || !resourceRef) {
            return result;
          }

          return authorizer
            .load({ permission, resourceRef })
            .then(decision =>
              decision.result === AuthorizeResult.ALLOW ? result : undefined,
            );
        }),
      ),
    );
  }
}
