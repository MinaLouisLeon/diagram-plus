import { describe, expect, it } from 'vitest';
import { createDiagram } from '../src/factory.js';
import { addBlocks, addEdges } from '../src/operations.js';
import {
  ARTBOARD_BAR,
  deriveDesign,
  designProgress,
  diffDesign,
  editDesign,
  factsOf,
  findHtml,
  layoutDesign,
  normalizeHtml,
  parseDesign,
  parseHtml,
  reconcileDesign,
  relaxArtboards,
  renderElementOutline,
  renderScreenOutline,
  walkScreen,
  type DesignDocument,
  type DesignOperation,
} from '../src/index.js';

/** A small diagram with the two screens most of these tests work against. */
function shop() {
  const diagram = createDiagram({ name: 'Shop', slug: 'shop' });
  addBlocks(diagram, [
    {
      type: 'ui_screen',
      name: 'Login',
      data: {
        route: '/login',
        purpose: 'Sign in',
        layout: 'centred form',
        state: [
          { name: 'email', type: 'string', required: true },
          { name: 'rememberMe', type: 'boolean' },
          { name: 'notes', type: 'string' },
        ],
        actions: [{ name: 'Sign in', calls: 'POST /api/session' }],
      },
    },
    {
      type: 'ui_screen',
      name: 'Products',
      data: { route: '/products', purpose: 'Browse', layout: 'a list of rows' },
    },
    { type: 'api_endpoint', name: 'Create session', data: { method: 'POST', path: '/api/session' } },
  ] as never);
  addEdges(diagram, [{ source: 'Login', target: 'Products', type: 'navigation' }] as never);
  return diagram;
}

function screenNamed(document: DesignDocument, name: string) {
  const screen = document.screens.find((s) => s.name === name);
  if (!screen) throw new Error(`no screen "${name}"`);
  return screen;
}

function apply(document: DesignDocument, ...operations: DesignOperation[]) {
  return editDesign(document, operations);
}

describe('reading markup written by hand', () => {
  it('finds an element by id, by its words, or by tag when there is one', () => {
    const html = normalizeHtml(
      '<main><h1>Patients</h1><button data-el="els_add">Add patient</button></main>',
    ).html;
    const fragment = parseHtml(html);

    expect(findHtml(fragment, 'els_add')?.tagName).toBe('button');
    expect(findHtml(fragment, 'Patients')?.tagName).toBe('h1');
    expect(findHtml(fragment, 'main')?.tagName).toBe('main');
    expect(findHtml(fragment, 'nothing here')).toBeNull();
  });

  it('reads the contract off an element', () => {
    const html = normalizeHtml(
      '<button data-action="POST /api/x" data-navigates-to="Done" disabled>Send</button>',
    ).html;
    const facts = factsOf(walkScreen(html)[0]!);

    expect(facts.tag).toBe('button');
    expect(facts.text).toBe('Send');
    expect(facts.action).toBe('POST /api/x');
    expect(facts.navigatesTo).toBe('Done');
    expect(facts.disabled).toBe(true);
    expect(facts.id).toMatch(/^els_/);
  });

  it('survives markup that was written carelessly', () => {
    // A person pastes this in, or a model closes a tag it never opened. The
    // job is to keep their design openable, not to adjudicate their HTML.
    const { html } = normalizeHtml('<div><p>One<p>Two</div><span>Three');
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html).toContain('Three');
    expect(normalizeHtml(html).html).toBe(html);
  });
});

describe('deriving designs from the diagram', () => {
  it('seeds a screen per UI block, carrying its bindings and actions across', () => {
    const document = deriveDesign(shop());
    expect(document.screens.map((s) => s.name)).toEqual(['Login', 'Products']);

    const login = screenNamed(document, 'Login');
    expect(login.route).toBe('/login');
    expect(login.blockId).toBeTruthy();

    const facts = walkScreen(login.html).map(factsOf);
    const email = facts.find((f) => f.binding === 'state.email');
    expect(email?.tag).toBe('input');
    expect(email?.required).toBe(true);

    // The field types steer the control chosen for them.
    expect(login.html).toContain('type="checkbox" data-binding="state.rememberMe"');
    expect(login.html).toMatch(/<textarea[^>]*data-binding="state\.notes"/);

    // The action became a button pointing at the endpoint it calls, and the
    // navigation edge told it where it goes afterwards.
    const button = facts.find((f) => f.tag === 'button');
    expect(button?.action).toBe('POST /api/session');
    expect(button?.navigatesTo).toBe('Products');
  });

  it('seeds real markup rather than a div for everything', () => {
    // The whole reason for the format: what comes out has to be showable.
    const login = screenNamed(deriveDesign(shop()), 'Login');
    expect(login.html).toContain('<main class="screen"');
    expect(login.html).toContain('<header class="topbar"');
    expect(login.html).toContain('<label');
    expect(login.html).toContain('<button');
  });

  it('reads the layout hint on the block', () => {
    const document = deriveDesign(shop());
    const products = screenNamed(document, 'Products');
    expect(products.html).toContain('data-repeat="Products"');
  });

  it('gives the document a stylesheet built on the tokens', () => {
    const document = deriveDesign(shop());
    expect(document.css).toContain('var(--color-accent)');
    expect(document.css).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('only covers blocks that have an interface', () => {
    const document = deriveDesign(shop());
    expect(document.screens.some((s) => s.name === 'Create session')).toBe(false);
  });
});

describe('keeping designs in step with the diagram', () => {
  it('adds new screens, keeps drawn ones, and flags ones whose block has gone', () => {
    const diagram = shop();
    const first = deriveDesign(diagram);

    const drawn = apply(first, {
      op: 'set_html',
      screen: 'Login',
      html: '<main class="screen"><h1>Hand-written</h1></main>',
    }).document;

    addBlocks(diagram, [{ type: 'ui_screen', name: 'Basket', data: { route: '/basket' } }] as never);
    diagram.blocks = diagram.blocks.filter((b) => b.name !== 'Products');

    const result = reconcileDesign(diagram, drawn);
    expect(result.added).toEqual(['Basket']);
    expect(result.orphaned).toEqual(['Products']);

    // The work survives; the loss is visible rather than silent.
    expect(screenNamed(result.document, 'Login').html).toContain('Hand-written');
    expect(screenNamed(result.document, 'Products').orphaned).toBe(true);
    expect(result.document.screens).toHaveLength(3);
  });

  it('tracks the block name until somebody words the screen themselves', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);

    const block = diagram.blocks.find((b) => b.name === 'Login')!;
    block.name = 'Sign in';
    expect(screenNamed(reconcileDesign(diagram, document).document, 'Sign in')).toBeTruthy();

    const edited = apply(document, {
      op: 'update_screen',
      screen: 'Login',
      name: 'Our lovely sign-in',
    }).document;
    block.name = 'Something else entirely';
    const after = reconcileDesign(diagram, edited).document;
    expect(after.screens.map((s) => s.name)).toContain('Our lovely sign-in');
  });

  it('reports what the diagram has that the designs do not', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);
    expect(diffDesign(diagram, document).hasChanges).toBe(false);

    addBlocks(diagram, [{ type: 'ui_screen', name: 'Basket', data: {} }] as never);
    const diff = diffDesign(diagram, document);
    expect(diff.undesigned.map((b) => b.name)).toEqual(['Basket']);
    expect(diff.hasChanges).toBe(true);
  });
});

describe('editing a design', () => {
  it('applies what it can and reports what it cannot', () => {
    const document = deriveDesign(shop());
    const result = apply(
      document,
      { op: 'set_html', screen: 'Login', html: '<main><h1>Sign in</h1></main>' },
      { op: 'set_html', screen: 'Nowhere', html: '<main></main>' },
    );

    expect(result.applied).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('Nowhere');
    expect(screenNamed(result.document, 'Login').html).toContain('Sign in');
  });

  it('inserts markup inside, before or after an element', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main><h1 data-el="els_title">Sign in</h1></main>',
    }).document;

    const after = apply(base, {
      op: 'insert_html',
      screen: 'Login',
      target: 'els_title',
      where: 'after',
      html: '<p>Welcome back.</p>',
    }).document;
    expect(screenNamed(after, 'Login').html).toMatch(/<\/h1><p[^>]*>Welcome back\.<\/p>/);

    const inside = apply(base, {
      op: 'insert_html',
      screen: 'Login',
      html: '<footer>Help</footer>',
    }).document;
    expect(screenNamed(inside, 'Login').html).toContain('<footer');
  });

  it('sets an attribute, and refuses to touch the editor\u2019s own handle', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main><input data-el="els_email"></main>',
    }).document;

    const bound = apply(base, {
      op: 'set_attribute',
      screen: 'Login',
      element: 'els_email',
      name: 'data-binding',
      value: 'state.email',
    }).document;
    expect(screenNamed(bound, 'Login').html).toContain('data-binding="state.email"');

    const cleared = apply(bound, {
      op: 'set_attribute',
      screen: 'Login',
      element: 'els_email',
      name: 'data-binding',
      value: null,
    }).document;
    expect(screenNamed(cleared, 'Login').html).not.toContain('data-binding');

    const refused = apply(base, {
      op: 'set_attribute',
      screen: 'Login',
      element: 'els_email',
      name: 'data-el',
      value: 'something-else',
    });
    expect(refused.errors[0]?.message).toContain('data-el');
  });

  it('replaces an element\u2019s words without emptying what is nested inside it', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main><div data-el="els_card">Old title<button>Press</button></div></main>',
    }).document;

    const retitled = apply(base, {
      op: 'set_text',
      screen: 'Login',
      element: 'els_card',
      text: 'New title',
    }).document;

    const html = screenNamed(retitled, 'Login').html;
    expect(html).toContain('New title');
    expect(html).not.toContain('Old title');
    expect(html).toContain('<button');
  });

  it('moves an element between parents, but never inside itself', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html:
        '<main data-el="els_main"><section data-el="els_a"><p data-el="els_p">Hi</p></section>' +
        '<section data-el="els_b"></section></main>',
    }).document;

    const moved = apply(base, {
      op: 'move_node',
      screen: 'Login',
      element: 'els_p',
      parent: 'els_b',
    }).document;
    expect(screenNamed(moved, 'Login').html).toMatch(
      /<section data-el="els_b"><p data-el="els_p">Hi<\/p><\/section>/,
    );

    const eaten = apply(base, {
      op: 'move_node',
      screen: 'Login',
      element: 'els_a',
      parent: 'els_p',
    });
    expect(eaten.errors[0]?.message).toContain('inside itself');
  });

  it('duplicates an element with fresh ids', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main><article data-el="els_card"><p data-el="els_p">Hi</p></article></main>',
    }).document;

    const copied = apply(base, {
      op: 'duplicate_node',
      screen: 'Login',
      element: 'els_card',
    }).document;

    const html = screenNamed(copied, 'Login').html;
    const ids = [...html.matchAll(/data-el="([^"]+)"/g)].map((m) => m[1]);
    expect(html.match(/<article/g)).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never removes the outermost element through remove_node', () => {
    const document = deriveDesign(shop());
    const base = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main data-el="els_main"><p>Hi</p></main>',
    }).document;

    const result = apply(base, { op: 'remove_node', screen: 'Login', element: 'els_main' });
    expect(result.errors[0]?.message).toContain('remove_screen');
  });

  it('makes a variant artboard pointing at the same block, with its own ids', () => {
    const document = deriveDesign(shop());
    const login = screenNamed(document, 'Login');
    const result = apply(document, {
      op: 'duplicate_screen',
      screen: 'Login',
      variant: 'Empty',
    });

    const copy = result.document.screens.find((s) => s.variant === 'Empty');
    expect(copy?.blockId).toBe(login.blockId);
    expect(copy?.html).not.toBe(login.html);

    const originalIds = new Set([...login.html.matchAll(/data-el="([^"]+)"/g)].map((m) => m[1]));
    const copyIds = [...(copy?.html ?? '').matchAll(/data-el="([^"]+)"/g)].map((m) => m[1]);
    expect(copyIds.some((id) => originalIds.has(id!))).toBe(false);
  });

  it('resolves a screen by name, by "Name / Variant" and by block id', () => {
    const document = deriveDesign(shop());
    const withVariant = apply(document, {
      op: 'duplicate_screen',
      screen: 'Login',
      variant: 'Empty',
    }).document;

    for (const ref of ['Login', 'Login / Empty', screenNamed(document, 'Login').blockId!]) {
      const result = apply(withVariant, { op: 'update_screen', screen: ref!, purpose: 'Set' });
      expect(result.errors, `resolving ${ref}`).toHaveLength(0);
    }
  });

  it('changing the device resizes the frame', () => {
    const document = deriveDesign(shop());
    const result = apply(document, { op: 'update_screen', screen: 'Login', device: 'mobile' });
    expect(screenNamed(result.document, 'Login').frame).toEqual({ width: 390, height: 844 });
  });
});

describe('arranging the canvas', () => {
  it('lays artboards out in rows and leaves dragged ones alone', () => {
    const document = deriveDesign(shop());
    const dragged = apply(document, {
      op: 'move_screen',
      screen: 'Products',
      x: 5000,
      y: 5000,
    }).document;

    const tidied = layoutDesign(dragged);
    expect(screenNamed(tidied, 'Products').position).toEqual({ x: 5000, y: 5000 });

    const forced = layoutDesign(dragged, { includePinned: true });
    expect(screenNamed(forced, 'Products').position.x).not.toBe(5000);
    expect(screenNamed(forced, 'Products').pinned).toBe(false);
  });
});

/** Every pair of artboards that is drawn on top of another, gutter included. */
function overlappingArtboards(document: DesignDocument): string[] {
  const boxes = document.screens.map((s) => ({
    name: s.name,
    x: s.position.x,
    y: s.position.y,
    right: s.position.x + s.frame.width,
    bottom: s.position.y + s.frame.height + ARTBOARD_BAR,
  }));
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      const a = boxes[i]!;
      const b = boxes[k]!;
      if (a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom) {
        clashes.push(`${a.name} × ${b.name}`);
      }
    }
  }
  return clashes;
}

describe('artboards never overlap', () => {
  it('moves neighbours clear when a screen is given a bigger frame', () => {
    // The bug this exists for: a model changes a screen to "wide", its frame
    // grows by 480px, and it buries the screen laid out beside it.
    const document = deriveDesign(shop());
    expect(overlappingArtboards(document)).toEqual([]);

    const grown = apply(document, {
      op: 'update_screen',
      screen: 'Login',
      device: 'wide',
    });

    expect(overlappingArtboards(grown.document)).toEqual([]);
    expect(screenNamed(grown.document, 'Login').frame).toEqual({ width: 1920, height: 1080 });
    expect(grown.corrections.join(' ')).toContain('overlap');
  });

  it('keeps the walkthrough order when it pulls them apart', () => {
    const document = deriveDesign(shop());
    const before = [...document.screens].sort((a, b) => a.position.x - b.position.x).map((s) => s.name);

    const grown = apply(document, { op: 'update_screen', screen: 'Login', device: 'wide' });
    const after = [...grown.document.screens]
      .sort((a, b) => a.position.x - b.position.x)
      .map((s) => s.name);

    expect(after).toEqual(before);
  });

  it('treats an artboard somebody dragged as an obstacle, never as something to move', () => {
    const document = deriveDesign(shop());
    const dragged = apply(document, { op: 'move_screen', screen: 'Products', x: 40, y: 40 });

    expect(screenNamed(dragged.document, 'Products').position).toEqual({ x: 40, y: 40 });
    expect(overlappingArtboards(dragged.document)).toEqual([]);
  });

  it('flows the grid around pinned artboards rather than leaving a hole under one', () => {
    const document = deriveDesign(shop());
    const dragged = apply(document, { op: 'move_screen', screen: 'Products', x: 0, y: 0 }).document;

    const tidied = layoutDesign(dragged);
    expect(screenNamed(tidied, 'Products').position).toEqual({ x: 0, y: 0 });
    expect(overlappingArtboards(tidied)).toEqual([]);
  });

  it('repairs a document written before the invariant existed', async () => {
    const document = deriveDesign(shop());
    const broken: DesignDocument = {
      ...document,
      screens: document.screens.map((s) => ({ ...s, position: { x: 0, y: 0 } })),
    };
    expect(overlappingArtboards(broken).length).toBeGreaterThan(0);

    const { screens } = relaxArtboards(broken.screens);
    expect(overlappingArtboards({ ...broken, screens })).toEqual([]);
  });
});

describe('nothing dangerous survives a write', () => {
  /** Draw a screen and hand back what actually landed. */
  function drawn(html: string) {
    const document = deriveDesign(shop());
    const result = apply(document, { op: 'set_html', screen: 'Login', html });
    return { html: screenNamed(result.document, 'Login').html, result };
  }

  it('strips scripts, handlers and javascript: urls, and says it did', () => {
    const { html, result } = drawn(
      `<main><script>steal()</script><h1 onclick="steal()">Hi</h1>` +
        `<a href="javascript:steal()">Go</a></main>`,
    );

    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    // The words survive; only the ways of doing something go.
    expect(html).toContain('Hi');
    expect(result.corrections.join(' ')).toContain('<script>');
  });

  it('keeps a remote image as a description rather than fetching it', () => {
    const { html } = drawn('<main><img src="https://example.com/x.jpg" alt="A waiting room"></main>');
    // The src is gone; the intent is kept where an implementer will see it.
    expect(html).not.toMatch(/[^-]src="https:/);
    expect(html).toContain('data-src="https://example.com/x.jpg"');
    expect(html).toContain('alt="A waiting room"');
  });

  it('leaves an inline data: image alone, which is what a design should use', () => {
    const { html } = drawn('<main><img src="data:image/svg+xml;base64,AAAA" alt="Logo"></main>');
    expect(html).toContain('src="data:image/svg+xml;base64,AAAA"');
  });

  it('refuses @import and remote url() in a stylesheet', () => {
    const document = deriveDesign(shop());
    const result = apply(document, {
      op: 'set_css',
      css: '@import url(evil.css); .a { background: url(https://x/y.png) } .b { color: red }',
    });
    expect(result.document.css).not.toContain('@import');
    expect(result.document.css).not.toContain('https://');
    expect(result.document.css).toContain('color: red');
  });

  it('gives every element an id, and the same document twice over', () => {
    const { html } = drawn('<main><section><p>Hi</p></section></main>');
    const ids = [...html.matchAll(/data-el="(els_[a-z0-9]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);

    // Normalising what is already normal changes nothing, which is what makes
    // it safe to run on every read.
    expect(normalizeHtml(html).html).toBe(html);
  });
});

describe('reading a design back', () => {
  it('writes the outline the implementer builds from', () => {
    const document = deriveDesign(shop());
    const outline = renderScreenOutline(screenNamed(document, 'Login'));

    expect(outline).toContain('desktop 1440×900');
    expect(outline).toContain('`/login`');
    expect(outline).toContain('value ← state.email');
    expect(outline).toContain('does → POST /api/session');
  });

  it('says which elements a container holds without repeating their words', () => {
    // A container borrowing every word underneath it turns the outline the
    // implementer reads into a wall of the same text three times over.
    const document = deriveDesign(shop());
    const drawn = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: '<main class="screen"><section><h1>Welcome back</h1><p>Sign in.</p></section></main>',
    }).document;

    const outline = renderElementOutline(screenNamed(drawn, 'Login').html);
    expect(outline).toContain('- main.screen\n');
    expect(outline).not.toContain('main.screen "Welcome back');
    expect(outline).toContain('h1 "Welcome back"');
  });

  it('states a table and a dropdown once rather than walking into them', () => {
    const document = deriveDesign(shop());
    const drawn = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: `<main><table data-repeat="Order" data-repeat-count="4">
        <thead><tr><th>Ref</th><th>Total</th></tr></thead>
        <tbody><tr><td>#1</td><td>£4</td></tr></tbody>
      </table>
      <select data-binding="state.size"><option>Small</option><option>Large</option></select></main>`,
    }).document;

    const outline = renderElementOutline(screenNamed(drawn, 'Login').html);
    expect(outline).toContain('columns: Ref, Total');
    expect(outline).toContain('repeats over Order (4 shown)');
    expect(outline).toContain('options: Small, Large');
    expect(outline).not.toContain('- th ');
    expect(outline).not.toContain('- option ');
  });

  it('can leave the styling out', () => {
    const document = deriveDesign(shop());
    const plain = renderElementOutline(screenNamed(document, 'Login').html, { showStyle: false });
    expect(plain).not.toContain('.topbar');
    expect(plain).toContain('- header');
  });
});

describe('progress', () => {
  it('counts the holes worth chasing', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);
    const drawn = apply(document, {
      op: 'set_html',
      screen: 'Login',
      html: `<main class="screen">
        <button>Do something</button>
        <a href="#">Go nowhere</a>
        <label>Quantity<input></label>
        <button data-action="POST /api/session">Sign in</button>
        <label>Email<input data-binding="state.email"></label>
        <input type="submit" value="Send">
      </main>`,
    }).document;

    const progress = designProgress(diagram, drawn);
    expect(progress.danglingActions.map((d) => d.element)).toEqual([
      'Do something',
      'Go nowhere',
    ]);
    expect(progress.unboundFields.map((d) => d.element)).toEqual(['input']);
  });

  it('does not count a seeded wireframe as designed', () => {
    const diagram = shop();
    const document = deriveDesign(diagram);
    expect(designProgress(diagram, document).completion).toBe(0);

    const drafted = apply(document, {
      op: 'update_screen',
      screen: 'Login',
      status: 'drafted',
    }).document;
    expect(designProgress(diagram, drafted).completion).toBeGreaterThan(0);
  });
});

describe('the file format', () => {
  it('round-trips through JSON', () => {
    const document = deriveDesign(shop());
    const back = parseDesign(JSON.parse(JSON.stringify(document)));
    expect(back).toEqual(document);
  });

  it('fills in everything a hand-written file leaves out', () => {
    const document = parseDesign({
      slug: 'sparse',
      screens: [{ id: 'scr_1', name: 'Only', html: '<main><p>Hi</p></main>' }],
    });
    const screen = document.screens[0]!;
    expect(screen.status).toBe('todo');
    expect(screen.frame).toEqual({ width: 1440, height: 900 });
    expect(screen.css).toBe('');
    expect(document.system.colors.length).toBe(0);
  });

  it('carries a version 1 element tree across to markup', () => {
    // The format a user's file is already in. Every binding, action and
    // destination has to come across, or an upgrade they never asked for
    // silently loses the wiring the whole tool exists to keep.
    const v1 = {
      formatVersion: 1,
      slug: 'legacy',
      screens: [
        {
          id: 'scr_1',
          name: 'Sign in',
          root: {
            id: 'els_1',
            type: 'stack',
            name: 'Screen',
            layout: { direction: 'column', gap: 24 },
            children: [
              { id: 'els_2', type: 'heading', text: 'Welcome back' },
              {
                id: 'els_3',
                type: 'input',
                label: 'Email',
                placeholder: 'you@example.com',
                binding: 'state.email',
                required: true,
              },
              {
                id: 'els_4',
                type: 'button',
                text: 'Sign in',
                variant: 'primary',
                action: 'POST /api/session',
                navigatesTo: 'Products',
              },
            ],
          },
        },
      ],
    };

    const document = parseDesign(v1);
    expect(document.formatVersion).toBe(2);

    const screen = document.screens[0]!;
    expect(screen).not.toHaveProperty('root');
    expect(screen.html).toContain('Welcome back');
    expect(screen.html).toContain('data-binding="state.email"');
    expect(screen.html).toContain('data-action="POST /api/session"');
    expect(screen.html).toContain('data-navigates-to="Products"');
    expect(screen.html).toContain('placeholder="you@example.com"');
    expect(screen.html).toContain('required');
    // And it is real markup, not a div for every element.
    expect(screen.html).toContain('<button');
    expect(screen.html).toContain('<input');
  });
});
