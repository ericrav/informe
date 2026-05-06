import {
  input,
  type InputDescriptor,
  type InputOptionList,
} from './input';
import { createNativeDateWidget } from './date';

export interface DatetimeInputOptions {
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  step?: number;
  options?: InputOptionList;
}

function createDatetimeIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const calendar = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  calendar.setAttribute(
    'd',
    'M3.5 2.25h9A1.75 1.75 0 0 1 14.25 4v3.25a.75.75 0 0 1-1.5 0v-.5h-9.5v5.75c0 .138.112.25.25.25h3.75a.75.75 0 0 1 0 1.5H3.5a1.75 1.75 0 0 1-1.75-1.75V4A1.75 1.75 0 0 1 3.5 2.25Zm0 1.5A.25.25 0 0 0 3.25 4v1.25h9.5V4a.25.25 0 0 0-.25-.25h-9Z',
  );

  const rings = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rings.setAttribute('d', 'M5 1.25a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0V2A.75.75 0 0 1 5 1.25Zm6 0a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0V2a.75.75 0 0 1 .75-.75Z');

  const clock = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  clock.setAttribute(
    'd',
    'M11 8.25a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5Zm0 1.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm.75.65v1.23l.8.8a.75.75 0 0 1-1.06 1.06l-1.02-1.02a.75.75 0 0 1-.22-.53V10.4a.75.75 0 0 1 1.5 0Z',
  );

  svg.append(calendar, rings, clock);
  return svg;
}

const datetimeWidget = createNativeDateWidget(
  'datetime-local',
  'informe-entry-widget-datetime',
  'Choose date and time',
  createDatetimeIcon,
);

export function datetime(
  options: DatetimeInputOptions = {},
): InputDescriptor<string> {
  const descriptor = input({ ...options, type: 'string' });
  descriptor.type = 'datetime';
  descriptor.widget = datetimeWidget;

  return descriptor;
}
