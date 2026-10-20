import Link from 'next/link';
import { categories, items, inr } from '@/lib/demo-data';
import { VegMark } from '@/components/ui';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { PreviewAction } from '@/components/ui/PreviewAction';
import type { AuthorizedWorkspace } from '@/lib/db/workspace-selection';

const FLOW = ['Draft', 'Review', 'Approve', 'Publish'];

/** Shared page structure; styled by the locked design system. */
export function MenuEditorScreen({
  workspace,
  workspaces,
}: {
  workspace?: AuthorizedWorkspace;
  workspaces?: AuthorizedWorkspace[];
} = {}) {
  const selected = items.find((i) => i.id === 'it-butter-chicken')!;
  const workspaceQuery = workspace ? `?workspace=${encodeURIComponent(workspace.slug)}` : '';

  return (
    <div className="pg pg--dash">
      <div className="pg__bar">
        <Link href="/" className="pg__brand">AutoDine</Link>
        <div className="pg__barLinks">
          <Link href={`/dashboard${workspaceQuery}`}>Overview</Link>
          <Link href={`/dashboard/menus${workspaceQuery}`} className="is-active">
            Menus
          </Link>
          <Link href={`/dashboard/tables${workspaceQuery}`}>Tables &amp; QR</Link>
          <Link href={`/dashboard/settings${workspaceQuery}`}>Settings</Link>
          <span>Orders</span>
          <span>Reports</span>
        </div>
        <div className="pg__barRight">
          {workspace && workspaces ? (
            <WorkspaceSwitcher workspaces={workspaces} selectedSlug={workspace.slug} pathname="/dashboard/menus" />
          ) : (
            <span className="pg__avatar">AP</span>
          )}
        </div>
      </div>

      <div className="pg__demoBanner">
        <strong>Demo — not saved.</strong>{' '}
        {workspace
          ? `Workspace access verified for ${workspace.name}; menu rows and controls below are still fictional previews.`
          : 'Menu editing, availability toggles and publishing are visual previews only.'}
      </div>

      <div className="pg__subbar">
        <div className="pg__subTabs">
          <span className="is-active">Main menu</span>
          <PreviewAction className="pg__subTabAction" message="Breakfast is a sample menu in this preview; no menu data changed.">Breakfast</PreviewAction>
          <PreviewAction className="pg__subTabAction" message="Creating menus is not connected in this preview.">+ New menu</PreviewAction>
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
            <PreviewAction className="pg__catsAdd" message="Adding categories is not connected in this preview.">+</PreviewAction>
          </div>
          {categories.map((c, i) => (
            <PreviewAction
              key={c.id}
              className={`pg__cat ${i === 2 ? 'is-active' : ''}`}
              message={`${c.name} is a demo category; filtering is not connected to live menu data.`}
            >
              <><span>{c.name}</span><span className="tnum">{c.count}</span></>
            </PreviewAction>
          ))}
          <div className="pg__catsFoot">
            <PreviewAction className="pg__importBtn" message="AI menu import is not enabled in this preview.">Import menu with AI</PreviewAction>
            <p className="pg__catsNote">Upload photos or a PDF. You review every item before it publishes.</p>
          </div>
        </aside>

        <section className="pg__items">
          <div className="pg__itemsHead">
            <h2>Curries &amp; Mains</h2>
            <div className="pg__itemsActions">
              <PreviewAction className="pg__btn" message="Items are demo-only here; no new database row was created.">Add item</PreviewAction>
              <PreviewAction className="pg__btn" message="Reordering is preview-only and was not saved.">Reorder</PreviewAction>
              <PreviewAction className="pg__btn" message="Bulk availability is not connected to live menu data.">Bulk availability</PreviewAction>
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
                      <span className="ui-badge ui-badge--sage">Demo</span>
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
            <PreviewAction className="pg__addChip" message="Variants are not saved in this preview.">+ Add variant</PreviewAction>
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
            <PreviewAction className="pg__btn" message="Draft changes are not saved. This workspace editor is still a demo.">Save draft</PreviewAction>
            <PreviewAction className="pg__btn pg__btn--solid" message="Review workflow is not connected; no menu was published.">Send for review</PreviewAction>
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
