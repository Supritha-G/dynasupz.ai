import { Module } from '@nestjs/common';
import { DynatraceService } from './dynatrace.service';

@Module({
  providers: [DynatraceService],
  exports: [DynatraceService],
})
export class DynatraceModule {}
