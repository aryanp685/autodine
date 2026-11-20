import type { VerifiedIrpCopy } from '@/lib/gst/irp/execution/presentation';

export function VerifiedIrpBlock({copy}:{copy:VerifiedIrpCopy}) {
  return <section aria-label="Verified IRP particulars" className="my-3 flex flex-wrap items-start gap-3 border border-hair p-3 text-sm break-inside-avoid">
    <img src={copy.qrImage} alt="Verified IRP signed QR code" width={168} height={168}/>
    <div className="min-w-0 max-w-full break-all">
      <h2 className="font-semibold">Verified IRP particulars</h2>
      <p>IRN: <span className="font-mono">{copy.reference}</span></p>
      <p>Acknowledgement no.: {copy.acknowledgement}</p>
      <p>Acknowledged on: {copy.acknowledgedAt}</p>
    </div>
  </section>;
}
