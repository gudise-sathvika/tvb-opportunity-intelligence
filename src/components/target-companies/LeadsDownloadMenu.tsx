import { useEffect, useRef, useState } from 'react'
import type { TargetCompanyLiveDiscoveryResult } from '../../target-companies/live-discovery'
import {
  downloadLeadsCsv,
  getLeadBatches,
  type LeadBatchInfo,
} from '../../target-companies/export-leads-csv'

export interface LeadsDownloadMenuProps {
  results: readonly TargetCompanyLiveDiscoveryResult[]
  companyName?: string
  totalLeads: number
  disabled?: boolean
  variant?: 'primary' | 'toolbar'
  idPrefix?: string
}

export default function LeadsDownloadMenu({
  results,
  companyName,
  totalLeads,
  disabled = false,
  variant = 'primary',
  idPrefix = 'action-bar',
}: LeadsDownloadMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const batches: LeadBatchInfo[] = getLeadBatches(totalLeads, 10)
  const hasMultipleBatches = batches.length > 1

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (totalLeads <= 0) return null

  const handleDownloadAll = () => {
    downloadLeadsCsv(results, companyName)
    setIsOpen(false)
  }

  const handleDownloadBatch = (batch: LeadBatchInfo) => {
    downloadLeadsCsv(results, companyName, 'Sathvika', {
      offset: batch.offset,
      limit: batch.limit,
      batchLabel: `${batch.start}-to-${batch.end}`,
    })
    setIsOpen(false)
  }

  const isPrimary = variant === 'primary'

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      <button
        type="button"
        id={`${idPrefix}-download-leads-btn`}
        aria-haspopup={hasMultipleBatches ? 'true' : undefined}
        aria-expanded={hasMultipleBatches ? isOpen : undefined}
        onClick={() => {
          if (hasMultipleBatches) {
            setIsOpen((prev) => !prev)
          } else {
            handleDownloadAll()
          }
        }}
        disabled={disabled}
        className={isPrimary ? 'btn btn--accent' : 'btn btn--sm'}
        style={
          isPrimary
            ? {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 18px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--radius, 6px)',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
              }
            : {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'var(--accent, #0284c7)',
                color: '#ffffff',
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }
        }
        title={
          hasMultipleBatches
            ? `Download leads (${totalLeads} total in batches of 10)`
            : 'Download qualified leads as CSV matching RFP & Grant template'
        }
      >
        <span aria-hidden="true" style={{ fontSize: isPrimary ? '15px' : '13px' }}>
          📥
        </span>
        <span>
          {isPrimary
            ? `Download Leads CSV (${totalLeads})`
            : `Export Leads (${totalLeads})`}
        </span>
        {hasMultipleBatches ? (
          <span
            aria-hidden="true"
            style={{
              fontSize: '11px',
              marginLeft: '2px',
              transition: 'transform 0.2s ease',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▼
          </span>
        ) : null}
      </button>

      {/* Dropdown Menu for Batches */}
      {isOpen && hasMultipleBatches ? (
        <div
          role="menu"
          aria-label="Lead download options"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 1000,
            minWidth: '260px',
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--border, rgba(0, 0, 0, 0.12))',
            borderRadius: 'var(--radius-lg, 10px)',
            boxShadow:
              '0 12px 30px -4px rgba(0, 0, 0, 0.2), 0 6px 14px -3px rgba(0, 0, 0, 0.12)',
            padding: '8px',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              padding: '6px 10px 8px',
              borderBottom: '1px solid var(--border, rgba(0, 0, 0, 0.08))',
              marginBottom: '6px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted, #64748b)',
              }}
            >
              Export Qualified Leads
            </div>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text, #1e293b)',
                marginTop: '2px',
              }}
            >
              {totalLeads} total leads by matching score
            </div>
          </div>

          {/* Option: Download All */}
          <button
            type="button"
            role="menuitem"
            onClick={handleDownloadAll}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              padding: '8px 10px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              color: 'var(--text, #1e293b)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              textAlign: 'left',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-2, rgba(16, 185, 129, 0.1))'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span>📥</span>
              <span>Download All Leads</span>
            </span>
            <span
              style={{
                fontSize: '11.5px',
                color: 'var(--accent, #059669)',
                fontWeight: 700,
              }}
            >
              All {totalLeads}
            </span>
          </button>

          {/* Batch Divider */}
          <div
            style={{
              margin: '6px 0',
              borderTop: '1px solid var(--border, rgba(0, 0, 0, 0.08))',
              paddingTop: '6px',
              paddingLeft: '10px',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted, #64748b)',
            }}
          >
            Batches of 10
          </div>

          {/* Batches 1-10, 11-20, 21-30... */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {batches.map((batch) => (
              <button
                key={batch.batchIndex}
                type="button"
                role="menuitem"
                onClick={() => handleDownloadBatch(batch)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '7px 10px',
                  border: 'none',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: 'var(--text, #1e293b)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface-2, rgba(0, 0, 0, 0.05))'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <span>📄</span>
                  <span>{batch.label}</span>
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--text-muted, #64748b)',
                  }}
                >
                  {batch.limit} leads
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
