import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { processFile } from '@/common/middlewares/processFile';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(processFile).forRoutes({
      path: 'attachments/upload',
      method: RequestMethod.POST,
    });
  }
}
