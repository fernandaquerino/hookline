import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { IngestStore } from './ingest.store';

@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestStore],
})
export class IngestModule {}
