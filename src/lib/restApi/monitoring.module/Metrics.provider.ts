// ============================================================================
// Copyright 2022, EPAM Systems
// Copyright 2022, Microsoft
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

import { Injectable } from '@nestjs/common';
import client from 'prom-client';

interface MapCounter {
  [key: string]: client.Counter<string>;
}

interface MapHistograms {
  [key: string]: client.Histogram<string>;
}

@Injectable()
export default class MetricsProvider {
  private readonly appTitle = 'OpenETPClient';
  private readonly registry: client.Registry;

  private readonly registeredCounters: MapCounter = {};
  private readonly registeredHistograms: MapHistograms = {};

  constructor() {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({ app: this.appTitle });
    client.collectDefaultMetrics({
      register: this.registry,
    });
  }

  public registerCounterMetric(
    name: string,
    help: string,
    labelNames: string[]
  ): client.Counter<string> {
    if (this.registeredCounters[name] === undefined) {
      // Register in this provider's registry only: prom-client otherwise also
      // registers in its global registry, which throws when a second app
      // instance (tests, embedded use) creates a second MetricsProvider.
      const counter = new client.Counter({
        name,
        help,
        labelNames,
        registers: [this.registry],
      });
      this.registeredCounters[name] = counter;
    }

    return this.registeredCounters[name];
  }

  public registerHistogram(
    name: string,
    help: string,
    labelNames: string[],
    buckets: number[]
  ): client.Histogram<string> {
    if (this.registeredHistograms[name] === undefined) {
      const histogram = new client.Histogram({
        name,
        help,
        labelNames,
        buckets,
        registers: [this.registry],
      });
      this.registeredHistograms[name] = histogram;
    }
    return this.registeredHistograms[name];
  }

  public get metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
