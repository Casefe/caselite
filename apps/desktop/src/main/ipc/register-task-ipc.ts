import {
  REMINDER_CHANNEL,
  reminderResponseSchema,
  type ReminderResponse,
} from '@caselite/contracts';
import type { createReminderApplication } from '@caselite/application';
import { CATALOG_CHANNEL, catalogResponseSchema, type CatalogResponse } from '@caselite/contracts';
import type { createCatalogApplication } from '@caselite/application';
import { TASK_CHANNEL, taskResponseSchema, type TaskResponse } from '@caselite/contracts';
import type { createTaskApplication } from '@caselite/application';
import { isTrustedDesktopSender } from './register-application-ipc';
import { BrowserWindow, ipcMain } from 'electron';

export function registerTaskIpc(application: ReturnType<typeof createTaskApplication>) {
  ipcMain.handle(TASK_CHANNEL, (event, payload): TaskResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本地任务。' };
    return taskResponseSchema.parse(application.execute(payload));
  });
}

export function registerCatalogIpc(application: ReturnType<typeof createCatalogApplication>) {
  ipcMain.handle(CATALOG_CHANNEL, (event, payload): CatalogResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本地目录。' };
    return catalogResponseSchema.parse(application.execute(payload));
  });
}

export function registerReminderIpc(
  application: ReturnType<typeof createReminderApplication>,
  changed: () => void,
) {
  ipcMain.handle(REMINDER_CHANNEL, (event, payload): ReminderResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本机提醒。' };
    const result = reminderResponseSchema.parse(application.execute(payload));
    if (result.ok && result.receipt) changed();
    return result;
  });
}
