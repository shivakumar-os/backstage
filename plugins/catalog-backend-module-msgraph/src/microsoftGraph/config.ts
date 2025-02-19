/*
 * Copyright 2020 The Backstage Authors
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

import { Config } from '@backstage/config';
import { trimEnd } from 'lodash';

/**
 * The configuration parameters for a single Microsoft Graph provider.
 *
 * @public
 */
export type MicrosoftGraphProviderConfig = {
  /**
   * The prefix of the target that this matches on, e.g.
   * "https://graph.microsoft.com/v1.0", with no trailing slash.
   */
  target: string;
  /**
   * The auth authority used.
   *
   * E.g. "https://login.microsoftonline.com"
   */
  authority?: string;
  /**
   * The tenant whose org data we are interested in.
   */
  tenantId: string;
  /**
   * The OAuth client ID to use for authenticating requests.
   */
  clientId: string;
  /**
   * The OAuth client secret to use for authenticating requests.
   */
  clientSecret: string;
  /**
   * The filter to apply to extract users.
   *
   * E.g. "accountEnabled eq true and userType eq 'member'"
   */
  userFilter?: string;
  /**
   * The filter to apply to extract users by groups memberships.
   *
   * E.g. "displayName eq 'Backstage Users'"
   */
  userGroupMemberFilter?: string;
  /**
   * The filter to apply to extract groups.
   *
   * E.g. "securityEnabled eq false and mailEnabled eq true"
   */
  groupFilter?: string;
};

/**
 * Parses configuration.
 *
 * @param config - The root of the msgraph config hierarchy
 *
 * @public
 */
export function readMicrosoftGraphConfig(
  config: Config,
): MicrosoftGraphProviderConfig[] {
  const providers: MicrosoftGraphProviderConfig[] = [];
  const providerConfigs = config.getOptionalConfigArray('providers') ?? [];

  for (const providerConfig of providerConfigs) {
    const target = trimEnd(providerConfig.getString('target'), '/');

    const authority = providerConfig.getOptionalString('authority')
      ? trimEnd(providerConfig.getOptionalString('authority'), '/')
      : 'https://login.microsoftonline.com';
    const tenantId = providerConfig.getString('tenantId');
    const clientId = providerConfig.getString('clientId');
    const clientSecret = providerConfig.getString('clientSecret');
    const userFilter = providerConfig.getOptionalString('userFilter');
    const userGroupMemberFilter = providerConfig.getOptionalString(
      'userGroupMemberFilter',
    );
    const groupFilter = providerConfig.getOptionalString('groupFilter');

    if (userFilter && userGroupMemberFilter) {
      throw new Error(
        `userFilter and userGroupMemberFilter are mutually exclusive, only one can be specified.`,
      );
    }

    providers.push({
      target,
      authority,
      tenantId,
      clientId,
      clientSecret,
      userFilter,
      userGroupMemberFilter,
      groupFilter,
    });
  }

  return providers;
}
