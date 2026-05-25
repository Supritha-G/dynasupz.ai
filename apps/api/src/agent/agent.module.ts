import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [SkillsModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
