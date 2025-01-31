import { ForbiddenError } from '@vtex/api'
import { json } from 'co-body'

import { getRole } from '../Queries/Roles'
import { getAppSettings, getSessionWatcher } from '../Queries/Settings'
import { getActiveUserByEmail, getUserByEmail } from '../Queries/Users'
import { generateClUser, QUERIES } from './utils'
import { setActiveUserByOrganization } from '../Mutations/Users'

export const Routes = {
  checkPermissions: async (ctx: Context) => {
    const {
      vtex: { logger },
    } = ctx

    ctx.set('Content-Type', 'application/json')
    await getAppSettings(null, null, ctx)

    const params: any = await json(ctx.req)

    let response

    if (!params?.app) {
      logger.warn({
        message: `checkPermissions-appNotDefined`,
        params,
      })

      throw new Error('App not defined')
    }

    if (!params?.email) {
      logger.warn({
        message: `checkPermissions-emailNotDefined`,
        params,
      })

      throw new Error('Email not defined')
    }

    const userData: any = await getUserByEmail(
      null,
      { email: params.email },
      ctx
    )

    if (!userData.length) {
      logger.warn({
        email: params.email,
        message: `checkPermissions-userNotFound`,
      })

      throw new Error('User not found')
    }

    if (userData.length) {
      const userRole: any = await getRole(null, { id: userData[0].roleId }, ctx)

      if (!userRole) {
        logger.warn({
          message: `checkPermissions-roleNotFound`,
          roleId: userData[0].roleId,
        })
        throw new Error('Role not found')
      }

      if (userRole) {
        const currentModule = userRole.features.find((feature: any) => {
          return feature.module === params.app
        })

        response = {
          permissions: currentModule?.features ?? [],
          role: userRole,
        }
      }
    }

    ctx.response.body = response
    ctx.response.status = 200
  },

  setProfile: async (ctx: Context) => {
    const {
      clients: {
        graphqlServer,
        checkout,
        profileSystem,
        salesChannel: salesChannelClient,
      },
      req,
      vtex: { logger },
    } = ctx

    const response: any = {
      public: {
        facets: {
          value: '',
        },
        sc: {
          value: '',
        },
      },
      'storefront-permissions': {
        costcenter: {
          value: '',
        },
        organization: {
          value: '',
        },
        priceTables: {
          value: '',
        },
        storeUserEmail: {
          value: '',
        },
        storeUserId: {
          value: '',
        },
        userId: {
          value: '',
        },
      },
    }

    ctx.set('Content-Type', 'application/json')
    ctx.set('Cache-Control', 'no-cache, no-store')

    const isWatchActive = await getSessionWatcher(null, null, ctx)

    if (!isWatchActive) {
      ctx.response.body = response
      ctx.response.status = 200

      return
    }

    const promises = [] as Array<Promise<any>>
    const body: any = await json(req)

    const b2bImpersonate = body?.public?.impersonate?.value

    const telemarketingImpersonate = body?.impersonate?.storeUserId?.value

    let email = body?.authentication?.storeUserEmail?.value
    const orderFormId = body?.checkout?.orderFormId?.value
    let businessName = null
    let businessDocument = null
    let phoneNumber = null
    let tradeName = null
    let stateRegistration = null

    if (b2bImpersonate) {
      await profileSystem
        .getProfileInfo(b2bImpersonate)
        .then((profile: any) => {
          response['storefront-permissions'].storeUserId.value = profile.userId
          response['storefront-permissions'].storeUserEmail.value =
            profile.email
          email = profile.email
        })
        .catch((error) => {
          logger.error({ message: 'setProfile.getProfileInfoError', error })
        })
    } else if (telemarketingImpersonate) {
      const telemarketingEmail = body?.impersonate?.storeUserEmail?.value

      response['storefront-permissions'].storeUserId.value =
        telemarketingImpersonate
      response['storefront-permissions'].storeUserEmail.value =
        telemarketingEmail
      email = telemarketingEmail
    }

    if (!email) {
      ctx.response.body = response
      ctx.response.status = 200

      return
    }

    const user = (await getActiveUserByEmail(null, { email }, ctx).catch(
      (error) => {
        logger.warn({ message: 'setProfile.getUserByEmailError', error })
      }
    )) as {
      orgId: string
      costId: string
      clId: string
      id: string
    }

    response['storefront-permissions'].userId.value = user?.id

    if (!user?.orgId || !user?.costId) {
      ctx.response.body = response
      ctx.response.status = 200

      return
    }

    response['storefront-permissions'].organization.value = user.orgId

    const getOrganization = async (orgId: any): Promise<any> => {
      return graphqlServer
        .query(
          QUERIES.getOrganizationById,
          { id: orgId },
          {
            persistedQuery: {
              provider: 'vtex.b2b-organizations-graphql@0.x',
              sender: 'vtex.storefront-permissions@1.x',
            },
          }
        )
        .catch((error) => {
          logger.error({
            error,
            message: 'setProfile.graphqlGetOrganizationById',
          })
        })
    }

    let organization = (await getOrganization(user.orgId))?.data
      ?.getOrganizationById

    // prevent login if org is inactive
    if (organization.status === 'inactive') {
      // try to find a valid organization
      const organizationsByUserResponse: any = await graphqlServer
        .query(
          QUERIES.getOrganizationsByEmail,
          { email },
          {
            provider: 'vtex.b2b-organizations-graphql@0.x',
            sender: 'vtex.storefront-permissions@1.x',
          }
        )
        .catch((error) => {
          logger.error({
            error,
            message: 'setProfile.graphqlGetOrganizationById',
          })
        })

      const organizationsByUser =
        organizationsByUserResponse?.data?.getOrganizationsByEmail

      if (organizationsByUser?.length) {
        const organizationList = organizationsByUser.find(
          (org: any) => org.organizationStatus !== 'inactive'
        )

        if (organizationList) {
          organization = (await getOrganization(organizationList.id))?.data
            ?.getOrganizationById

          try {
            await setActiveUserByOrganization(
              null,
              {
                costId: organizationList.costId,
                email,
                orgId: organizationList.orgId,
                userId: organizationList.id,
              },
              ctx
            )
          } catch (error) {
            logger.warn({
              error,
              message: 'setProfile.setActiveUserByOrganizationError',
            })
          }
        }
      } else {
        logger.warn({
          message: `setProfile-organizationInactive`,
          organizationData: organization,
          organizationId: user.orgId,
        })
        throw new ForbiddenError('Organization is inactive')
      }
    }

    businessName = organization.name
    tradeName = organization.tradeName

    if (organization.priceTables?.length) {
      response[
        'storefront-permissions'
      ].priceTables.value = `${organization.priceTables.join(',')}`
    }

    if (organization.collections?.length) {
      const collections = organization.collections.map(
        (collection: any) => `productClusterIds=${collection.id}`
      )

      response.public.facets.value = `${collections.join(';')}`
    }

    response['storefront-permissions'].costcenter.value = user.costId
    const costCenterResponse: any = await graphqlServer
      .query(
        QUERIES.getCostCenterById,
        { id: user.costId },
        {
          persistedQuery: {
            provider: 'vtex.b2b-organizations-graphql@0.x',
            sender: 'vtex.storefront-permissions@1.x',
          },
        }
      )
      .catch((error) => {
        logger.error({
          error,
          message: 'setProfile.graphqlGetCostCenterById',
        })
      })

    phoneNumber = costCenterResponse.data.getCostCenterById.phoneNumber

    businessDocument =
      costCenterResponse.data.getCostCenterById.businessDocument

    stateRegistration =
      costCenterResponse.data.getCostCenterById.stateRegistration

    let { salesChannel } = organization

    const salesChannels = (await salesChannelClient.getSalesChannel()) as any
    const validChannels = salesChannels.filter(
      (channel: any) => channel.IsActive
    )

    if (
      !salesChannel?.length ||
      !validChannels?.find(
        (validSalesChannel: any) =>
          String(validSalesChannel.Id) === salesChannel.toString()
      )
    ) {
      if (validChannels.length) {
        salesChannel = validChannels[0].Id
      }
    }

    if (salesChannel) {
      try {
        await checkout
          .updateSalesChannel(orderFormId, salesChannel)
          .catch((error) => {
            console.error(error)
            logger.error({
              error,
              message: 'setProfile.updateSalesChannel',
            })
          })

        response.public.sc.value = Number(salesChannel)
      } catch (error) {
        logger.error({
          error,
          message: 'setProfile.updateSalesChannel',
        })
      }
    }

    if (
      costCenterResponse?.data?.getCostCenterById?.addresses?.length &&
      orderFormId
    ) {
      const [address] = costCenterResponse.data.getCostCenterById.addresses

      const marketingTagsResponse: any = await graphqlServer
        .query(
          QUERIES.getMarketingTags,
          {
            costId: user.costId,
          },
          {
            persistedQuery: {
              provider: 'vtex.b2b-organizations-graphql@0.x',
              sender: 'vtex.storefront-permissions@1.x',
            },
          }
        )
        .catch((error) => {
          logger.error({
            error,
            message: 'setProfile.getMarketingTags',
          })
        })

      const marketingTags: any =
        marketingTagsResponse?.data?.getMarketingTags?.tags

      promises.push(
        checkout
          .updateOrderFormMarketingData(orderFormId, {
            attachmentId: 'marketingData',
            marketingTags: marketingTags || [],
            utmCampaign: user.orgId,
            utmMedium: user.costId,
          })
          .catch((error) => {
            logger.error({
              error,
              message: 'setProfile.updateOrderFormMarketingDataError',
            })
          })
      )

      promises.push(
        checkout
          .updateOrderFormShipping(orderFormId, {
            address,
            clearAddressIfPostalCodeNotFound: false,
          })
          .catch((error) => {
            logger.error({
              error,
              message: 'setProfile.updateOrderFormShippingError',
            })
          })
      )
    }

    const clUser = await generateClUser({
      businessDocument,
      businessName,
      clId: user?.clId,
      ctx,
      phoneNumber,
      stateRegistration,
      tradeName,
    })

    if (clUser && orderFormId) {
      promises.push(
        checkout
          .updateOrderFormProfile(orderFormId, {
            ...clUser,
            businessDocument: businessDocument || clUser.businessDocument,
            stateInscription: stateRegistration || clUser.stateInscription,
          })
          .catch((error) => {
            logger.error({
              error,
              message: 'setProfile.updateOrderFormProfileError',
            })
          })
      )
    }

    // Don't await promises, to avoid session timeout
    Promise.all(promises)

    ctx.response.body = response
    ctx.response.status = 200
  },
}
