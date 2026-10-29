import assert from 'node:assert/strict'
import { test } from 'node:test'

import { evaluateTargetCompanyRelevance } from './matching'

test('shared sector terms make an opportunity relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C1', name: 'Acme EdTech', sector: 'education technology', capabilities: ['learning platforms'] },
    { opportunityId: 'O1', opportunityType: 'funding', title: 'Digital learning grants', description: 'Support for education technology platforms', sourceUrl: 'https://example.org/o1' },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.ok(result.matchedFields.includes('sector/capabilities'))
})

test('education technology company is not matched to bridge construction', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C2', name: 'Acme EdTech', sector: 'education technology', capabilities: ['learning platforms'], country: 'US' },
    { opportunityId: 'O2', opportunityType: 'procurement', title: 'Bridge construction services', description: 'Civil engineering and bridge construction', country: 'US', sourceUrl: 'https://example.org/o2' },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('missing company data produces uncertainty, not fabrication', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C3', name: 'Growth Channel' },
    { opportunityId: 'O3', opportunityType: 'funding', title: 'AI infrastructure grant', description: 'Funding for AI infrastructure', sourceUrl: 'https://example.org/o3' },
  )
  assert.ok(['insufficient_evidence', 'potentially_relevant'].includes(result.outcome))
  assert.ok(result.missingFields.includes('company.sector/description/capabilities'))
  assert.ok(result.uncertainty.length > 0)
})

test('eligibility is reported separately and not assumed', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C4', name: 'Acme', sector: 'AI infrastructure', country: 'US', companyType: 'SME' },
    { opportunityId: 'O4', opportunityType: 'procurement', title: 'AI infrastructure tender', description: 'AI infrastructure services', country: 'US', applicantTypes: ['SME'], requirements: ['eligibility screening required'], sourceUrl: 'https://example.org/o4' },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.ok(result.matchedFields.includes('applicantType'))
  assert.ok(result.uncertainty.some((value) => /eligibility/i.test(value)))
})

test('Austin, US matches US without creating relevance by itself', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C5', name: 'Acme', country: 'Austin, US' },
    { opportunityId: 'O5', opportunityType: 'funding', title: 'Generic funding', description: 'No sector overlap', country: 'US', sourceUrl: 'https://example.org/o5' },
  )
  assert.notEqual(result.outcome, 'relevant')
  assert.ok(result.matchedFields.includes('country'))
})

test('Bangalore, India matches India', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C6', name: 'Pacewisdom', country: 'Bangalore, India', sector: 'Software Services, AI' },
    { opportunityId: 'O6', opportunityType: 'funding', title: 'Software services grant', description: 'software services', country: 'India', sourceUrl: 'https://example.org/o6' },
  )
  assert.ok(result.matchedFields.includes('country'))
})

test('dual-branch company with presence in India and US matches both Indian and US opportunities', () => {
  const dualCompany = {
    companyId: 'C-DUAL',
    name: 'Pacewisdom Solutions',
    country: 'Bangalore, India and San Francisco, US',
    sector: 'Software Services, AI',
    capabilities: ['custom web applications', 'cloud migration'],
  }

  // 1. Indian opportunity match
  const indiaResult = evaluateTargetCompanyRelevance(
    dualCompany,
    { opportunityId: 'O-IN', opportunityType: 'funding', title: 'MeitY Software Innovation Grant', description: 'custom web applications', country: 'India', sourceUrl: 'https://meity.gov.in/1' },
  )
  assert.ok(indiaResult.matchedFields.includes('country'))
  assert.ok(indiaResult.reasons.some((r) => r.includes('India headquarters / operating branch')))

  // 2. US opportunity match
  const usResult = evaluateTargetCompanyRelevance(
    dualCompany,
    { opportunityId: 'O-US', opportunityType: 'procurement', title: 'US Federal Cloud Migration RFP', description: 'cloud migration', country: 'US', sourceUrl: 'https://grants.gov/1' },
  )
  assert.ok(usResult.matchedFields.includes('country'))
  assert.ok(usResult.reasons.some((r) => r.includes('US branch / operating subsidiary')))

  // 3. Negative test: Non-operating country (e.g. UK restricted) produces geographic mismatch
  const ukResult = evaluateTargetCompanyRelevance(
    dualCompany,
    { opportunityId: 'O-UK', opportunityType: 'procurement', title: 'UK Domestic Procurement', description: 'software services', country: 'United Kingdom', sourceUrl: 'https://ted.europa.eu/1' },
  )
  assert.ok(ukResult.mismatchedFields.includes('country'))
})

test('generic single-term overlap is not enough for relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C7', name: 'Acme', sector: 'AI Infrastructure', country: 'US' },
    { opportunityId: 'O7', opportunityType: 'funding', title: 'Infrastructure hubs', description: 'infrastructure', country: 'US', sourceUrl: 'https://example.org/o7' },
  )
  assert.notEqual(result.outcome, 'relevant')
})

test('missing location creates uncertainty', () => {
  const result = evaluateTargetCompanyRelevance(
    { companyId: 'C8', name: 'Growth Channel' },
    { opportunityId: 'O8', opportunityType: 'funding', title: 'AI infrastructure', description: 'ai infrastructure', sourceUrl: 'https://example.org/o8' },
  )
  assert.ok(result.missingFields.includes('company.country'))
})

// --- Phase 14 Comprehensive Test Suite Across All 5 Portfolio Companies ---

const CHIPRAMA = {
  companyId: 'CHIPRAMA-1',
  name: 'Chiprama',
  country: 'Austin, Texas, US',
  sector: 'Semiconductor engineering; ASIC/SoC design; embedded systems; chip verification; AI accelerators; edge computing',
  capabilities: ['ASIC/SoC design', 'RTL design', 'verification', 'physical design', 'firmware', 'secure boot', 'edge computing'],
  description: 'Test profile based on company published service description: semiconductor and embedded engineering work, including ASIC/SoC design, RTL design and verification, physical design, firmware, secure boot, and edge/AI-related systems.',
  companyType: 'SME',
}

const CYBERDUEDIL = {
  companyId: 'CYBERDUEDIL-1',
  name: 'CyberDueDil',
  country: 'Manchester, United Kingdom',
  sector: 'Cybersecurity; cyber due diligence; investment and portfolio cyber risk',
  capabilities: ['cybersecurity assessments', 'cyber due diligence', 'risk monitoring', 'maturity assessment', 'remediation planning'],
  description: 'Test profile based on company published service description: cybersecurity assessments for mergers and acquisitions, cyber-risk visibility for investment portfolios, risk monitoring, maturity assessment, and remediation planning.',
  companyType: 'commercial',
}

const SCHOOL_MINT = {
  companyId: 'SCHOOLMINT-1',
  name: 'School Mint',
  country: null,
  sector: 'K-12 education technology; student recruitment and enrollment management',
  capabilities: ['K-12 school enrollment workflows', 'student recruitment', 'application and lottery management', 'registration', 'school search'],
  description: 'Test profile based on published service description: K-12 school enrollment workflows, student recruitment, application and lottery management, registration, school search, enrollment communications.',
  companyType: 'SME',
}

const OPENRAG = {
  companyId: 'OPENRAG-1',
  name: 'OpenRAG Innovations Pvt. Ltd.',
  country: null,
  sector: 'Generative AI; retrieval-augmented generation; context engineering; AI reliability',
  capabilities: ['context-engine pipelines', 'retrieval/context filtering', 'hallucination reduction', 'grounded responses'],
  description: 'Test profile: context-engine pipelines, retrieval/context filtering, and techniques intended to reduce hallucinations and improve grounded responses.',
  companyType: 'pvt. ltd.',
}

const TGEN = {
  companyId: 'TGEN-1',
  name: 'TGen',
  country: 'Phoenix, Arizona, US',
  sector: 'Nonprofit biomedical research; genomics; precision medicine; computational biology',
  capabilities: ['translational genomics', 'disease research', 'genomic data analysis', 'precision medicine', 'computational biology'],
  description: 'Test profile based on published research description: translational genomics, disease research, cancer and neurological conditions, genomic data analysis, precision medicine, and computational approaches.',
  companyType: 'Nonprofit',
}

// 1. Chiprama Tests
test('Chiprama: matches relevant semiconductor and ASIC engineering opportunity with high score', () => {
  const result = evaluateTargetCompanyRelevance(
    CHIPRAMA,
    {
      opportunityId: 'CHIP-REL-1',
      opportunityType: 'funding',
      title: 'Advanced Microelectronics and ASIC Verification Development',
      description: 'Federal funding for semiconductor engineering and ASIC/SoC verification design.',
      country: 'US',
      applicantTypes: ['SME', 'For-Profit'],
      sourceUrl: 'https://grants.gov/chip-rel-1',
    },
  )
  assert.equal(result.outcome, 'relevant')
  assert.equal(result.scoreStatus, 'SCORED')
  assert.ok((result.score ?? 0) >= 70)
  assert.equal(result.topicalRelevance, 'strong_match')
  assert.equal(result.applicantEligibilityStatus, 'eligible')
  assert.ok(result.matchedFields.includes('sector/capabilities'))
  assert.ok(result.matchedFields.includes('country'))
  assert.ok(result.matchedFields.includes('applicantType'))
})

test('Chiprama: negative test - unrelated agricultural irrigation grant is not relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    CHIPRAMA,
    {
      opportunityId: 'CHIP-IRR-1',
      opportunityType: 'funding',
      title: 'Rural Agricultural Irrigation and Canal Water Infrastructure',
      description: 'Funding for irrigation systems and agricultural water conservation.',
      country: 'US',
      sourceUrl: 'https://grants.gov/chip-irr-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.score, 0)
  assert.equal(result.topicalRelevance, 'unrelated')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('Chiprama: negative test - generic keyword overlap does not produce relevant classification or inflated score', () => {
  const result = evaluateTargetCompanyRelevance(
    CHIPRAMA,
    {
      opportunityId: 'CHIP-GEN-1',
      opportunityType: 'funding',
      title: 'Digital Cloud Platform and Data Systems Innovation Hub',
      description: 'Modernizing cloud data systems, technology infrastructure, and software platforms.',
      country: 'US',
      sourceUrl: 'https://grants.gov/chip-gen-1',
    },
  )
  assert.notEqual(result.outcome, 'relevant')
  assert.equal(result.scoreStatus, 'PROVISIONAL')
  assert.ok((result.score ?? 0) < 50)
  assert.ok(['weak_match', 'unrelated'].includes(result.topicalRelevance ?? ''))
  assert.ok(result.reasons.some((reason) => /generic keywords|generic term/i.test(reason)))
})

test('Chiprama: negative test - explicit higher education restriction marks opportunity not_relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    CHIPRAMA,
    {
      opportunityId: 'CHIP-ELIG-1',
      opportunityType: 'funding',
      title: 'University Microelectronics Research Center Consortium',
      description: 'Semiconductor engineering research in university laboratories.',
      country: 'US',
      applicantTypes: ['Higher Education Institutions Only', 'Universities'],
      sourceUrl: 'https://grants.gov/chip-elig-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.applicantEligibilityStatus, 'ineligible')
  assert.ok(result.mismatchedFields.includes('applicantType'))
  assert.ok(result.reasons.some((reason) => /higher education/i.test(reason)))
})

// 2. CyberDueDil Tests
test('CyberDueDil: matches relevant UK cybersecurity due diligence tender with high score', () => {
  const result = evaluateTargetCompanyRelevance(
    CYBERDUEDIL,
    {
      opportunityId: 'CYBER-REL-1',
      opportunityType: 'procurement',
      title: 'Cybersecurity Due Diligence and Investment Portfolio Risk Assessment',
      description: 'Provision of cyber due diligence, risk monitoring, and portfolio vulnerability assessments.',
      country: 'United Kingdom',
      applicantTypes: ['commercial', 'enterprise'],
      sourceUrl: 'https://ted.europa.eu/cyber-rel-1',
    },
  )
  assert.equal(result.outcome, 'relevant')
  assert.equal(result.scoreStatus, 'SCORED')
  assert.ok((result.score ?? 0) >= 70)
  assert.equal(result.topicalRelevance, 'strong_match')
  assert.ok(result.matchedFields.includes('sector/capabilities'))
  assert.ok(result.matchedFields.includes('country'))
})

test('CyberDueDil: negative test - highway asphalt resurfacing tender is not relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    CYBERDUEDIL,
    {
      opportunityId: 'CYBER-IRR-1',
      opportunityType: 'procurement',
      title: 'Highway Asphalt Resurfacing and Pavement Maintenance',
      description: 'Civil engineering works for road repaving and structural asphalt repairs.',
      country: 'UK',
      sourceUrl: 'https://ted.europa.eu/cyber-irr-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.score, 0)
  assert.equal(result.topicalRelevance, 'unrelated')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('CyberDueDil: negative test - US domestic SBIR grant creates geographic mismatch', () => {
  const result = evaluateTargetCompanyRelevance(
    CYBERDUEDIL,
    {
      opportunityId: 'CYBER-GEO-1',
      opportunityType: 'funding',
      title: 'US Domestic Critical Infrastructure Cyber Defense SBIR',
      description: 'Cybersecurity research and cyber risk monitoring.',
      country: 'US',
      sourceUrl: 'https://grants.gov/cyber-geo-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.ok(result.mismatchedFields.includes('country'))
  assert.ok(result.reasons.some((reason) => /country differs/i.test(reason)))
})

// 3. School Mint Tests
test('School Mint: strong topical match with missing company location is marked PROVISIONAL', () => {
  const result = evaluateTargetCompanyRelevance(
    SCHOOL_MINT,
    {
      opportunityId: 'SM-REL-1',
      opportunityType: 'procurement',
      title: 'K-12 School Student Recruitment and Enrollment Management Platform',
      description: 'Software platform for student enrollment, school lottery management, and family communications.',
      country: 'US',
      sourceUrl: 'https://example.org/sm-rel-1',
    },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.equal(result.scoreStatus, 'PROVISIONAL')
  assert.equal(result.topicalRelevance, 'strong_match')
  assert.ok(result.missingFields.includes('company.country'))
  assert.ok(result.uncertainty.some((uncertainty) => /geographic/i.test(uncertainty)))
})

test('School Mint: negative test - bridge seismic retrofit contract is not relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    SCHOOL_MINT,
    {
      opportunityId: 'SM-IRR-1',
      opportunityType: 'procurement',
      title: 'Seismic Bridge Reinforcement and Structural Engineering',
      description: 'Civil engineering and structural concrete reinforcement for highway bridges.',
      sourceUrl: 'https://example.org/sm-irr-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.score, 0)
  assert.equal(result.topicalRelevance, 'unrelated')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('School Mint: negative test - generic IT support services with no EdTech scope is not strong match', () => {
  const result = evaluateTargetCompanyRelevance(
    SCHOOL_MINT,
    {
      opportunityId: 'SM-GEN-1',
      opportunityType: 'procurement',
      title: 'General IT Hardware and Technical Software Support Services',
      description: 'Digital systems support, data services, and technology infrastructure.',
      sourceUrl: 'https://example.org/sm-gen-1',
    },
  )
  assert.notEqual(result.outcome, 'relevant')
  assert.equal(result.scoreStatus, 'PROVISIONAL')
  assert.ok((result.score ?? 0) < 50)
})

// 4. OpenRAG Innovations Pvt. Ltd. Tests
test('OpenRAG: matches Generative AI / RAG scope but marks scoreStatus PROVISIONAL due to missing location', () => {
  const result = evaluateTargetCompanyRelevance(
    OPENRAG,
    {
      opportunityId: 'RAG-REL-1',
      opportunityType: 'funding',
      title: 'Generative AI Reliability and Retrieval-Augmented Generation (RAG) Frameworks',
      description: 'Research grants to develop context engineering pipelines, hallucination reduction, and grounded retrieval.',
      country: 'US',
      sourceUrl: 'https://grants.gov/rag-rel-1',
    },
  )
  assert.equal(result.outcome, 'potentially_relevant')
  assert.equal(result.scoreStatus, 'PROVISIONAL')
  assert.equal(result.topicalRelevance, 'strong_match')
  assert.ok(result.missingFields.includes('company.country'))
})

test('OpenRAG: negative test - heavy industrial farm equipment maintenance is not relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    OPENRAG,
    {
      opportunityId: 'RAG-IRR-1',
      opportunityType: 'procurement',
      title: 'Heavy Industrial Farm Machinery Maintenance and Tractor Repair',
      description: 'Maintenance services for agricultural machinery and harvesting equipment.',
      sourceUrl: 'https://ted.europa.eu/rag-irr-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.score, 0)
  assert.equal(result.topicalRelevance, 'unrelated')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('OpenRAG: negative test - higher education restricted call rejects commercial Pvt Ltd entity', () => {
  const result = evaluateTargetCompanyRelevance(
    OPENRAG,
    {
      opportunityId: 'RAG-ELIG-1',
      opportunityType: 'funding',
      title: 'Academic Generative AI Research Center',
      description: 'Context engineering research for universities.',
      applicantTypes: ['Higher Education Institutions Only', 'Universities'],
      sourceUrl: 'https://grants.gov/rag-elig-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.applicantEligibilityStatus, 'ineligible')
  assert.ok(result.mismatchedFields.includes('applicantType'))
})

// 5. TGen Tests
test('TGen: matches NIH biomedical genomics research grant with high score and verified nonprofit status', () => {
  const result = evaluateTargetCompanyRelevance(
    TGEN,
    {
      opportunityId: 'TGEN-REL-1',
      opportunityType: 'funding',
      title: 'Translational Genomics and Precision Medicine for Neurological Disease',
      description: 'Biomedical research grant for disease research, precision medicine, genomic data analysis, and computational biology.',
      country: 'US',
      applicantTypes: ['Nonprofit', 'Higher Education'],
      sourceUrl: 'https://grants.gov/tgen-rel-1',
    },
  )
  assert.equal(result.outcome, 'relevant')
  assert.equal(result.scoreStatus, 'SCORED')
  assert.ok((result.score ?? 0) >= 75)
  assert.equal(result.topicalRelevance, 'strong_match')
  assert.equal(result.applicantEligibilityStatus, 'eligible')
  assert.ok(result.matchedFields.includes('sector/capabilities'))
  assert.ok(result.matchedFields.includes('country'))
  assert.ok(result.matchedFields.includes('applicantType'))
})

test('TGen: negative test - parking garage construction is not relevant', () => {
  const result = evaluateTargetCompanyRelevance(
    TGEN,
    {
      opportunityId: 'TGEN-IRR-1',
      opportunityType: 'procurement',
      title: 'Municipal Parking Garage Concrete Paving and Structural Construction',
      description: 'Civil construction of multi-story parking structure and concrete deck repairs.',
      country: 'US',
      sourceUrl: 'https://example.org/tgen-irr-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.score, 0)
  assert.equal(result.topicalRelevance, 'unrelated')
  assert.ok(result.mismatchedFields.includes('sector/capabilities'))
})

test('TGen: negative test - commercial for-profit small business SBIR set-aside rejects nonprofit institute', () => {
  const result = evaluateTargetCompanyRelevance(
    TGEN,
    {
      opportunityId: 'TGEN-ELIG-1',
      opportunityType: 'funding',
      title: 'Small Business Commercialization SBIR Phase II',
      description: 'Biomedical computational biology commercialization.',
      country: 'US',
      applicantTypes: ['For-Profit Small Business Only', 'Commercial Entities Only'],
      sourceUrl: 'https://grants.gov/tgen-elig-1',
    },
  )
  assert.equal(result.outcome, 'not_relevant')
  assert.equal(result.applicantEligibilityStatus, 'ineligible')
  assert.ok(result.mismatchedFields.includes('applicantType'))
  assert.ok(result.reasons.some((reason) => /nonprofit/i.test(reason)))
})

// 6. Independence & Quality Invariant Tests
test('company-opportunity evaluations remain completely independent across batch runs', () => {
  const opportunity = {
    opportunityId: 'IND-1',
    opportunityType: 'funding' as const,
    title: 'Advanced Microelectronics and ASIC Verification Development',
    description: 'Federal funding for semiconductor engineering and ASIC/SoC verification design.',
    country: 'US',
    applicantTypes: ['SME'],
    sourceUrl: 'https://grants.gov/ind-1',
  }

  const singleResult = evaluateTargetCompanyRelevance(CHIPRAMA, opportunity)

  // Evaluated in a batch alongside all other 4 companies
  const batchResults = [CHIPRAMA, CYBERDUEDIL, SCHOOL_MINT, OPENRAG, TGEN].map((company) =>
    evaluateTargetCompanyRelevance(company, opportunity),
  )

  const chipramaBatchResult = batchResults.find((result) => result.companyId === CHIPRAMA.companyId)
  assert.deepEqual(singleResult, chipramaBatchResult)
})