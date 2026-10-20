import { useState } from 'react'
import { loadImportedTargetCompanies } from '../../target-companies/store'
import { csvPreviewToTargetCompanies } from '../../target-companies/profiles'
import { loadProfileCompletion, saveProfileCompletion } from '../../target-companies/profile-completion'

export default function TargetCompanyProfileCompletion() {
  const imported = loadImportedTargetCompanies()
  if (!imported) return null
  const companies = csvPreviewToTargetCompanies(imported)

  return (
    <section className="page" aria-labelledby="target-profile-completion-heading">
      <h2 className="page__title page__title--sub" id="target-profile-completion-heading">
        Target company profile completion
      </h2>
      <p className="page__description">
        Optional manager-supplied fields. Missing values remain unknown and are not inferred.
      </p>
      <ul>
        {companies.map((company) => (
          <li key={company.companyId}>
            <ProfileEditor name={company.name} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProfileEditor({ name }: { name: string }) {
  const initial = loadProfileCompletion(name)
  const [values, setValues] = useState(initial)
  return (
    <div>
      <h3>{name}</h3>
      <label>
        Products/services
        <input value={values.productsServices ?? ''} onChange={(e) => setValues({ ...values, productsServices: e.target.value })} />
      </label>
      <label>
        Technical capabilities
        <input value={values.capabilities ?? ''} onChange={(e) => setValues({ ...values, capabilities: e.target.value })} />
      </label>
      <label>
        Target industries/customers
        <input value={values.targetIndustries ?? ''} onChange={(e) => setValues({ ...values, targetIndustries: e.target.value })} />
      </label>
      <label>
        Preferred opportunity types
        <input value={values.preferredOpportunityTypes ?? ''} onChange={(e) => setValues({ ...values, preferredOpportunityTypes: e.target.value })} />
      </label>
      <label>
        Delivery/applicant countries
        <input value={values.deliveryCountries ?? ''} onChange={(e) => setValues({ ...values, deliveryCountries: e.target.value })} />
      </label>
      <label>
        Applicant/company category
        <input value={values.applicantCategory ?? ''} onChange={(e) => setValues({ ...values, applicantCategory: e.target.value })} />
      </label>
      <button type="button" className="btn" onClick={() => saveProfileCompletion(name, values)}>
        Save profile details
      </button>
    </div>
  )
}