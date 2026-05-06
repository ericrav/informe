import {
  input,
  type InputDescriptor,
  type InputOptionList,
  type InputWidget,
} from './input';

export interface ColorInputOptions {
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
  placeholder?: string;
  options?: InputOptionList;
}

const colorWidget: InputWidget = (ctx) => {
  const swatch = document.createElement('span');
  swatch.contentEditable = 'false';
  swatch.className =
    'informe-entry-widget informe-entry-widget-color informe-entry-widget-color--empty';

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.tabIndex = -1;
  picker.className = 'informe-entry-color-picker';
  picker.setAttribute('aria-hidden', 'true');
  swatch.append(picker);

  const handleInput = () => {
    ctx.setValue(picker.value);
  };

  picker.addEventListener('input', handleInput);
  ctx.onDestroy(() => {
    picker.removeEventListener('input', handleInput);
  });

  ctx.onUpdate((value) => {
    picker.value = value;
    swatch.style.backgroundColor = value;

    if (value.trim() && swatch.style.backgroundColor) {
      swatch.classList.remove('informe-entry-widget-color--empty');
    } else {
      swatch.style.backgroundColor = '';
      swatch.classList.add('informe-entry-widget-color--empty');
    }
  });

  return swatch;
};

export function color(options: ColorInputOptions = {}): InputDescriptor<string> {
  const descriptor = input({ ...options, type: 'string' });
  descriptor.type = 'color';
  descriptor.widget = colorWidget;

  return descriptor;
}
