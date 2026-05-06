import {
  input,
  type InputDescriptor,
  type InputOptionList,
  type InputWidget,
} from './input';

export interface DateInputOptions {
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

function createCalendarIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  outline.setAttribute(
    'd',
    'M3.5 2.25h9A1.75 1.75 0 0 1 14.25 4v8.5a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 1.75 12.5V4A1.75 1.75 0 0 1 3.5 2.25Zm0 1.5A.25.25 0 0 0 3.25 4v1.25h9.5V4a.25.25 0 0 0-.25-.25h-9Zm9.25 3h-9.5v5.75c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V6.75Z',
  );

  const leftRing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  leftRing.setAttribute('d', 'M5 1.25a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0V2A.75.75 0 0 1 5 1.25Z');

  const rightRing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rightRing.setAttribute('d', 'M11 1.25a.75.75 0 0 1 .75.75v2a.75.75 0 0 1-1.5 0V2a.75.75 0 0 1 .75-.75Z');

  svg.append(outline, leftRing, rightRing);
  return svg;
}

export function createNativeDateWidget(
  inputType: 'date' | 'datetime-local',
  className: string,
  label: string,
  createIcon: () => SVGSVGElement,
): InputWidget {
  return (ctx) => {
    const wrapper = document.createElement('span');
    wrapper.contentEditable = 'false';
    wrapper.className = `informe-entry-widget ${className}`;
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('aria-label', label);
    wrapper.append(createIcon());

    const picker = document.createElement('input');
    picker.type = inputType;
    picker.tabIndex = -1;
    picker.className = 'informe-entry-native-picker';
    picker.setAttribute('aria-hidden', 'true');
    wrapper.append(picker);

    const handleChange = () => {
      ctx.setValue(picker.value);
    };

    picker.addEventListener('change', handleChange);
    ctx.onDestroy(() => {
      picker.removeEventListener('change', handleChange);
    });

    ctx.onUpdate((value) => {
      picker.value = value;

      if (typeof ctx.descriptor.min === 'string') {
        picker.min = ctx.descriptor.min;
      } else {
        picker.removeAttribute('min');
      }

      if (typeof ctx.descriptor.max === 'string') {
        picker.max = ctx.descriptor.max;
      } else {
        picker.removeAttribute('max');
      }

      if (typeof ctx.descriptor.step === 'number') {
        picker.step = String(ctx.descriptor.step);
      } else {
        picker.removeAttribute('step');
      }
    });

    return wrapper;
  };
}

const dateWidget = createNativeDateWidget(
  'date',
  'informe-entry-widget-date',
  'Choose date',
  createCalendarIcon,
);

export function date(options: DateInputOptions = {}): InputDescriptor<string> {
  const descriptor = input({ ...options, type: 'string' });
  descriptor.type = 'date';
  descriptor.widget = dateWidget;

  return descriptor;
}
