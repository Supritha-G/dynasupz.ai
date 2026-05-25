import { Module } from '@nestjs/common';
import { SkillsService } from './skills.service';
import { DynatraceModule } from '../dynatrace/dynatrace.module';

@Module({
  imports: [DynatraceModule],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
