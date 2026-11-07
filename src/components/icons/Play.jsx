import { Icon } from './Icon';

export const Play = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <polygon points="6 3 20 12 6 21 6 3" />
    </Icon>
);
