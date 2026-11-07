/**
 * Najmniejszy DOM, w którym react-dom/client montuje proste drzewo (elementy, tekst, atrybuty, kliknięcie) — w repozytorium
 * nie ma jsdom, a osłony błędów (error boundary) działają tylko w renderze klienta, nie w renderToStaticMarkup.
 * Tylko do testów: bez stylów, układu i zaznaczenia.
 */

type Listener = { fn: (e: unknown) => void; capture: boolean };

export class MiniNode {
  childNodes: MiniNode[] = [];
  parentNode: MiniNode | null = null;
  private listeners = new Map<string, Listener[]>();
  // Pola, które react-dom czyta albo ustawia na węzłach
  onclick: unknown = null;
  constructor(
    readonly ownerDocument: MiniDocument,
    readonly nodeType: number,
    readonly nodeName: string
  ) {}
  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): MiniNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): MiniNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild<T extends MiniNode>(c: T): T {
    c.parentNode?.removeChild(c);
    this.childNodes.push(c);
    c.parentNode = this;
    return c;
  }
  insertBefore<T extends MiniNode>(c: T, ref: MiniNode | null): T {
    if (!ref) return this.appendChild(c);
    c.parentNode?.removeChild(c);
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild<T extends MiniNode>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument.createTextNode(v));
  }
  addEventListener(type: string, fn: (e: unknown) => void, opt?: boolean | { capture?: boolean }): void {
    const capture = typeof opt === 'boolean' ? opt : !!opt?.capture;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn)
    );
  }
  /** Słuchacze typu (react-dom słucha na korzeniu: najpierw przechwytywanie, potem bąbelkowanie). */
  fire(e: unknown & { type: string }): void {
    const list = this.listeners.get(e.type) ?? [];
    for (const l of list.filter((x) => x.capture)) l.fn(e);
    for (const l of list.filter((x) => !x.capture)) l.fn(e);
  }
}

export class MiniText extends MiniNode {
  constructor(
    doc: MiniDocument,
    public nodeValue: string
  ) {
    super(doc, 3, '#text');
  }
  override get textContent(): string {
    return this.nodeValue;
  }
  override set textContent(v: string) {
    this.nodeValue = v;
  }
  get data(): string {
    return this.nodeValue;
  }
  set data(v: string) {
    this.nodeValue = v;
  }
}

export class MiniElement extends MiniNode {
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void; removeProperty(k: string): void } = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
    removeProperty(k: string) {
      delete this[k];
    },
  };
  constructor(
    doc: MiniDocument,
    readonly tagName: string,
    readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  ) {
    super(doc, 1, tagName.toUpperCase());
  }
  setAttributeNS(_ns: string | null, k: string, v: string): void {
    this.setAttribute(k, v);
  }
  removeAttributeNS(_ns: string | null, k: string): void {
    this.removeAttribute(k);
  }
  setAttribute(k: string, v: string): void {
    this.attributes.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attributes.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attributes.delete(k);
  }
  hasAttribute(k: string): boolean {
    return this.attributes.has(k);
  }
  /** Potomkowie (w kolejności dokumentu) spełniający warunek. */
  findAll(pred: (e: MiniElement) => boolean): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniNode) => {
      for (const c of n.childNodes) {
        if (c instanceof MiniElement) {
          if (pred(c)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
}

export class MiniDocument extends MiniNode {
  readonly body: MiniElement;
  readonly documentElement: MiniElement;
  readonly defaultView: { document: MiniDocument; HTMLIFrameElement: new () => unknown; event?: unknown };
  activeElement: MiniElement | null = null;
  constructor() {
    super(null as unknown as MiniDocument, 9, '#document');
    (this as { ownerDocument: MiniDocument }).ownerDocument = this;
    this.documentElement = new MiniElement(this, 'html');
    this.body = new MiniElement(this, 'body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.defaultView = { document: this, HTMLIFrameElement: class {} };
  }
  createElement(tag: string): MiniElement {
    return new MiniElement(this, tag.toLowerCase());
  }
  createElementNS(ns: string, tag: string): MiniElement {
    return new MiniElement(this, tag, ns);
  }
  createTextNode(text: string): MiniText {
    return new MiniText(this, text);
  }
}

/**
 * Globalne `window` i `document` z małego DOM (vi.stubGlobal w teście) i kontener pod korzeń React.
 * `click` — kliknięcie elementu przez słuchaczy react-dom na kontenerze.
 */
export function miniDom() {
  const document = new MiniDocument();
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Zegary przez globalne funkcje w chwili wywołania (działają z vi.useFakeTimers)
  const window = Object.assign(document.defaultView, {
    addEventListener() {},
    removeEventListener() {},
    location: { hash: '', href: 'http://localhost/' },
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
    setInterval: (fn: () => void, ms?: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id?: ReturnType<typeof setInterval>) => globalThis.clearInterval(id),
  });
  const click = (target: MiniElement) => {
    let stopped = false;
    const e = {
      type: 'click',
      target,
      srcElement: target,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      button: 0,
      buttons: 0,
      detail: 1,
      timeStamp: Date.now(),
      isTrusted: true,
      preventDefault() {
        e.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      get cancelBubble() {
        return stopped;
      },
    };
    container.fire(e);
  };
  return { document, window, container, click };
}
