import { Icon } from './Icon';

export const Tv = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <rect width="20" height="15" x="2" y="7" rx="2" />
        <path d="m17 2-5 5-5-5" />
    </Icon>
);
