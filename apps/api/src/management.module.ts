import { Module } from '@nestjs/common';
import { DeadLettersService } from './deliveries/dead-letters.service';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { ReplayService } from './deliveries/replay.service';
import { DestinationPolicy } from './destinations/destination-policy';
import { DestinationsController } from './destinations/destinations.controller';
import { DestinationsService } from './destinations/destinations.service';
import { EndpointsController } from './endpoints/endpoints.controller';
import { EndpointsService } from './endpoints/endpoints.service';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { StreamController } from './live/stream.controller';
import { RequestsController } from './requests/requests.controller';
import { RequestsService } from './requests/requests.service';

/** The management API used by the dashboard, plus /health. */
@Module({
  controllers: [
    EndpointsController,
    DestinationsController,
    RequestsController,
    DeliveriesController,
    StreamController,
    HealthController,
  ],
  providers: [
    EndpointsService,
    DestinationsService,
    DestinationPolicy,
    RequestsService,
    ReplayService,
    DeadLettersService,
    HealthService,
  ],
})
export class ManagementModule {}
