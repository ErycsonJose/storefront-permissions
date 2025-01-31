import { getUserById } from '../../Queries/Users'

export class ErrorResponse extends Error {
  public response: {
    status: number
  } = {
    status: 500,
  }
}

export const QUERIES = {
  getCostCenterById: `query Costcenter($id: ID!) {
      getCostCenterById(id: $id) {
        paymentTerms {
          id
          name
        }
        addresses {
          addressId
          addressType
          addressQuery
          postalCode
          country
          receiverName
          city
          state
          street
          number
          complement
          neighborhood
          geoCoordinates
          reference
        }
        phoneNumber
        businessDocument
        stateRegistration
      }
    }`,
  getMarketingTags: `
    query ($costId: ID!) {
      getMarketingTags(costId: $costId) @context(provider: "vtex.b2b-organizations-graphql") {
        tags
      }
    }
  `,
  getOrganizationById: `query Organization($id: ID!){
      getOrganizationById(id: $id) @context(provider: "vtex.b2b-organizations-graphql"){
        name
        tradeName
        status
        priceTables
        salesChannel
        collections {
          id
        }
      }
    }`,
  getOrganizationsByEmail: `query Organizations($email: String!) {
       getOrganizationsByEmail(email: $email) @context(provider: "vtex.b2b-organizations-graphql") {
          id
          organizationStatus
          costId
          orgId
       }
  }`,
}

export const generateClUser = async ({
  clId,
  phoneNumber,
  businessName,
  businessDocument,
  tradeName,
  stateRegistration,
  ctx,
}: {
  clId: string
  phoneNumber: string | null
  businessName: string | null
  businessDocument: string | null
  tradeName: string | null
  stateRegistration: string | null
  ctx: Context
}) => {
  const {
    vtex: { logger },
  } = ctx

  if (!clId) {
    return null
  }

  const clUser = await getUserById(null, { id: clId }, ctx).catch((error) => {
    logger.error({ message: 'setProfile.getUserByIdError', error })
  })

  if (!clUser) {
    return null
  }

  if (clUser.isCorporate === null) {
    clUser.isCorporate = false
  }

  if (phoneNumber) {
    clUser.phone = phoneNumber
  }

  if (businessName && businessDocument) {
    clUser.isCorporate = true
    clUser.corporateName = businessName
    clUser.corporateDocument = businessDocument
    clUser.stateInscription = stateRegistration
    if (phoneNumber) {
      clUser.corporatePhone = phoneNumber
    }

    if (tradeName) {
      clUser.tradeName = tradeName
    }
  }

  return clUser
}
