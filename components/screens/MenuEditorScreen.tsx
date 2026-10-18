import Link from 'next/link';
import { categories, items, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';

const FLOW = ['Draft', 'Review', 'Approve', 'Publish'];

/** Shared page structure; styled by the locked design system. */
export function MenuEditorScreen() {
  const selected = items.find((i) => i.id === 'it-butter-chicken')!;

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/menus" className="is-active">
            Menus
          </Link>
          <Link href="/dashboard/tables">Tables &amp; QR</Link>
          <span>Orders</span>
          <span>Reports</span>
        </div>
        <div className="pg__barRight">
          <span className="pg__avatar">AP</span>
        </div>
      </div>

      <div className="pg__subbar">
        <div className="pg__subTabs">
          <span className="is-active">Main menu</span>
          <span> Breakfast</span>
          <span> + New menu</span>
        </div>
        <div className="pg__flow">
          {FLOW.map((f, i) => (
            <span key={f} className={`pg__flowStep ${i === 0 ? 'is-current' : ''}`}>
              {i + 1}. {f}
            </span>
          ))}
          <span className="pg__flowState">Status: Draft</span>
        </div>
      </div>

      <div className="pg__split">
        <aside className="pg__cats">
          <div className="pg__catsHead">
            Categories
            <span className="pg__catsAdd">+</span>
          </div>
          {categories.map((c, i) => (
            <div key={c.id} className={`pg__cat ${i === 2 ? 'is-active' : ''}`}>
              <span>{c.name}</span>
              <span className="tnum">{c.count}</span>
            </div>
          ))}
          <div className="pg__catsFoot">
            <span className="pg__importBtn">Import menu with AI</span>
            <p className="pg__catsNote">Upload photos or a PDF. You review every item before it publishes.</p>
          </div>
        </aside>

        <section className="pg__items">
          <div className="pg__itemsHead">
            <h2>Curries &amp; Mains</h2>
            <div className="pg__itemsActions">
              <span className="pg__btn">Add item</span>
              <span className="pg__btn">Reorder</span>
              <span className="pg__btn">Bulk availability</span>
            </div>
          </div>
          <table className="ui-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Availability</th>
                <th>Variants</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i) => i.category === 'curries')
                .map((i) => (
                  <tr key={i.id} className={i.id === selected.id ? 'is-active' : undefined}>
                    <td>
                      <div className="pg__itemCell">
                        <VegMark veg={i.veg} />
                        <div>
                          <strong>{i.name}</strong>
                          <div className="pg__itemDesc">{i.desc}</div>
                        </div>
                      </div>
                    </td>
                    <td className="tnum">{inr(i.price)}</td>
                    <td>
                      <span className={`pg__toggle ${i.available ? 'is-on' : 'is-off'}`}>
                        <i /> {i.available ? 'Available' : 'Sold out'}
                      </span>
                    </td>
                    <td className="tnum">{i.variants ? i.variants.length : '—'}</td>
                    <td>
                      <span className="ui-badge ui-badge--sage">Live</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        <aside className="pg__editor">
          <div className="pg__editorHead">
            <h3>{selected.name}</h3>
            <span className="ui-badge ui-badge--outline">Editing draft</span>
          </div>

          <label className="ui-field">
            <span className="ui-label">Item name</span>
            <input className="ui-input" defaultValue={selected.name} />
          </label>
          <label className="ui-field">
            <span className="ui-label">Description</span>
            <textarea className="ui-input" rows={3} defaultValue={selected.desc} />
          </label>
          <div className="pg__fieldRow">
            <label className="ui-field">
              <span className="ui-label">Price (₹)</span>
              <input className="ui-input tnum" defaultValue={selected.price} />
            </label>
            <label className="ui-field">
              <span className="ui-label">Food type</span>
              <select className="ui-select" defaultValue={selected.veg ? 'veg' : 'non'}>
                <option value="veg">Vegetarian</option>
                <option value="non">Non-vegetarian</option>
              </select>
            </label>
          </div>

          <div className="pg__editorGroup">
            <div className="pg__editorLabel">Variants</div>
            {selected.variants?.map((v) => (
              <div key={v.id} className="pg__chipRow">
                <span className="pg__chip">{v.name}</span>
                <span className="tnum">{inr(v.price)}</span>
              </div>
            ))}
            <span className="pg__addChip">+ Add variant</span>
          </div>

          <div className="pg__editorGroup">
            <div className="pg__editorLabel">Modifier groups</div>
            {selected.modifiers?.map((m) => (
              <div key={m.id} className="pg__mod">
                <div className="pg__modTop">
                  <strong>{m.name}</strong>
                  <span className="pg__modMeta">{m.type === 'single' ? 'Choose one' : 'Choose many'}{m.required ? ' · required' : ''}</span>
                </div>
                <div className="pg__modOpts">
                  {m.options.map((o) => (
                    <span key={o.id} className="pg__chip">
                      {o.name}
                      {o.price > 0 && <em className="tnum"> +{inr(o.price)}</em>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="pg__editorFoot">
            <span className="pg__btn">Save draft</span>
            <span className="pg__btn pg__btn--solid">Send for review</span>
          </div>
          <p className="pg__fine">
            Published changes never alter past orders or receipts — every order keeps its own snapshot of items,
            prices and modifiers.
          </p>
        </aside>
      </div>
    </div>
  );
}
