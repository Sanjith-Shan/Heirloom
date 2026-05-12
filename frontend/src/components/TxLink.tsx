import { explorerTxUrl, explorerAddressUrl, explorerName } from "@/lib/utils";

interface TxProps {
  chainId: number;
  txHash: string;
  className?: string;
}

export function TxLink({ chainId, txHash, className }: TxProps) {
  const url = explorerTxUrl(chainId, txHash);
  const display = txHash ? `${txHash.slice(0, 10)}…${txHash.slice(-6)}` : "—";
  if (!url) return <span className={"font-mono text-xs " + (className ?? "")}>{display}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "font-mono text-xs underline decoration-neutral-700 underline-offset-2 " +
        "hover:decoration-white hover:text-white text-neutral-300 " +
        (className ?? "")
      }
      title={`View on ${explorerName(chainId)}`}
    >
      {display} ↗
    </a>
  );
}

interface AddrProps {
  chainId: number;
  address: string;
  className?: string;
}

export function AddressLink({ chainId, address, className }: AddrProps) {
  const url = explorerAddressUrl(chainId, address);
  const display = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
  if (!url) return <span className={"font-mono text-xs " + (className ?? "")}>{display}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "font-mono text-xs underline decoration-neutral-700 underline-offset-2 " +
        "hover:decoration-white hover:text-white text-neutral-300 " +
        (className ?? "")
      }
      title={`View on ${explorerName(chainId)}`}
    >
      {display} ↗
    </a>
  );
}
