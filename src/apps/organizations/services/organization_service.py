"""Organization management service"""
import logging
from src.apps.organizations.models import Organization, OrganizationMember, Subscription

logger = logging.getLogger(__name__)


class OrganizationService:
    """Handle organization operations"""

    @staticmethod
    def create_organization(name, slug, owner, **kwargs):
        """Create new organization"""
        try:
            org = Organization.objects.create(
                name=name,
                slug=slug,
                owner=owner,
                **kwargs
            )

            # Add owner as admin
            OrganizationMember.objects.create(
                organization=org,
                user=owner,
                role=OrganizationMember.Role.ADMIN
            )

            # Create free subscription
            Subscription.objects.create(
                organization=org,
                tier=Subscription.Tier.FREE,
                billing_email=owner.email
            )

            logger.info(f"Created organization: {org.name}")
            return org

        except Exception as e:
            logger.error(f"Failed to create organization: {str(e)}")
            raise

    @staticmethod
    def add_member(organization, user, role=OrganizationMember.Role.MEMBER):
        """Add member to organization"""
        try:
            member, created = OrganizationMember.objects.get_or_create(
                organization=organization,
                user=user,
                defaults={'role': role}
            )

            if not created:
                member.is_active = True
                member.save()

            logger.info(f"Added {user.email} to {organization.name}")
            return member

        except Exception as e:
            logger.error(f"Failed to add member: {str(e)}")
            raise

    @staticmethod
    def remove_member(organization, user):
        """Remove member from organization"""
        try:
            member = OrganizationMember.objects.get(
                organization=organization,
                user=user
            )
            member.is_active = False
            member.save()

            logger.info(f"Removed {user.email} from {organization.name}")
            return True

        except OrganizationMember.DoesNotExist:
            logger.warning(f"Member not found")
            return False


class SubscriptionService:
    """Handle subscription operations"""

    @staticmethod
    def upgrade_subscription(organization, new_tier):
        """Upgrade organization subscription"""
        try:
            subscription = Subscription.objects.get(organization=organization)
            subscription.tier = new_tier
            subscription.save()

            logger.info(f"Upgraded {organization.name} to {new_tier}")
            return subscription

        except Exception as e:
            logger.error(f"Failed to upgrade subscription: {str(e)}")
            raise

    @staticmethod
    def get_plan_limits(tier):
        """Get feature limits for subscription tier"""
        limits = {
            'free': {
                'max_meetings': 10,
                'max_participants_per_meeting': 50,
                'recording_hours': 0,
                'storage_gb': 1,
                'custom_branding': False
            },
            'pro': {
                'max_meetings': 100,
                'max_participants_per_meeting': 300,
                'recording_hours': 50,
                'storage_gb': 100,
                'custom_branding': True
            },
            'enterprise': {
                'max_meetings': None,  # Unlimited
                'max_participants_per_meeting': None,
                'recording_hours': None,
                'storage_gb': None,
                'custom_branding': True
            }
        }
        return limits.get(tier, limits['free'])
