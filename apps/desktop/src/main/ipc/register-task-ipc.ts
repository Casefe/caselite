import {
  CONTACTS_CHANNEL,
  contactsResponseSchema,
  type ContactsResponse,
} from '@caselite/contracts';
import type { createContactsApplication } from '@caselite/application';
import { FINANCE_CHANNEL, financeResponseSchema, type FinanceResponse } from '@caselite/contracts';
import type { createFinanceApplication } from '@caselite/application';
import {
  REMINDER_CHANNEL,
  reminderResponseSchema,
  type ReminderResponse,
} from '@caselite/contracts';
import type { createReminderApplication } from '@caselite/application';
import { CATALOG_CHANNEL, catalogResponseSchema, type CatalogResponse } from '@caselite/contracts';
import type { createCatalogApplication } from '@caselite/application';
import { TASK_CHANNEL, taskResponseSchema, type TaskResponse } from '@caselite/contracts';
import { isTrustedDesktopSender } from './register-application-ipc';
import { BrowserWindow, ipcMain } from 'electron';

export function registerTaskIpc(application: {
  execute(input: unknown): TaskResponse | Promise<TaskResponse>;
}) {
  ipcMain.handle(TASK_CHANNEL, async (event, payload): Promise<TaskResponse> => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本地任务。' };
    return taskResponseSchema.parse(await application.execute(payload));
  });
}

export function registerFinanceIpc(application: ReturnType<typeof createFinanceApplication>) {
  ipcMain.handle(FINANCE_CHANNEL, (event, payload): FinanceResponse => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问本地财务。' };
    return financeResponseSchema.parse(application.execute(payload));
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

export function registerContactsIpc(
  application: ReturnType<typeof createContactsApplication>,
  allowed: Parameters<ReturnType<typeof createContactsApplication>['executeForOwner']>[2],
) {
  ipcMain.handle(CONTACTS_CHANNEL, async (event, payload): Promise<ContactsResponse> => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问联系人。' };
    const result = await application.executeForOwner(
      payload,
      String(event.sender.id),
      async (source, owner) =>
        isTrustedDesktopSender(event, BrowserWindow.getAllWindows()) &&
        (await allowed(source, owner)) &&
        isTrustedDesktopSender(event, BrowserWindow.getAllWindows()),
    );
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面已关闭或失去访问权限。' };
    return contactsResponseSchema.parse(result);
  });
}
