export function requiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof Element)) throw new Error(`Missing #${id}.`);
  return element as unknown as T;
}

export function fieldLabel(forId: string, text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.htmlFor = forId;
  const caption = document.createElement("span");
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

export function inputField(form: HTMLFormElement, id: string, label: string, type: string, required: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.name = id;
  input.type = type;
  input.required = required;
  form.append(fieldLabel(id, label, input));
  return input;
}
